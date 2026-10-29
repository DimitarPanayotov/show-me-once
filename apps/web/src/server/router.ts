import { ORPCError, os } from '@orpc/server';
import { parseSkillPlan, checkedSkillDocument } from '@show-me-once/shared';
import { z } from 'zod';
import { loginAccount, registerAccount, revokeSession } from './auth';
import { db } from './db';
import { checkedInput, hostedProvider } from '@show-me-once/agent';
import { DEFAULT_AGENT_MODELS } from '@show-me-once/shared/agent';

type Identity = { id: string; email: string; name: string | null };
type Context = { user: Identity | null; token: string | null; signal?: AbortSignal };
const base = os.$context<Context>();

function requireUser(user: Identity | null): Identity {
  if (!user) throw new ORPCError('UNAUTHORIZED', { message: 'Sign in first.' });
  return user;
}

function checkedPlan(markdown: string) {
  try { return parseSkillPlan(markdown); }
  catch { throw new ORPCError('BAD_REQUEST', { message: 'The SKILL.md executable plan is invalid or unsafe.' }); }
}

function checkedDocument(input: { title: string; description: string; markdown: string }) {
  try { return checkedSkillDocument({ ...input, name: input.title }).markdown; }
  catch (error) { throw new ORPCError('BAD_REQUEST', { message: error instanceof Error ? error.message : 'Check the skill header.' }); }
}

const credentials = z.object({
  email: z.email().transform(value => value.toLowerCase()),
  password: z.string().min(12).max(128),
});
const skillData = z.object({
  title: z.string().trim().min(3).max(80),
  description: z.string().trim().min(3).max(300),
  markdown: z.string().min(20).max(200_000),
});
const id = z.object({ id: z.string().min(1) });

export const router = {
  health: base.handler(async () => ({ status: 'ok' as const, service: 'show-me-once' })),
  agent: {
    providers: base.handler(async ({ context }) => {
      requireUser(context.user);
      return [
        { id: 'openai', label: 'OpenAI', available: !!process.env.OPENAI_API_KEY && !!process.env.OPENAI_MODEL },
        { id: 'anthropic', label: 'Anthropic', available: !!process.env.ANTHROPIC_API_KEY && !!process.env.ANTHROPIC_MODEL },
      ];
    }),
    decide: base.input(z.object({ provider: z.enum(['openai', 'anthropic']), input: z.unknown(), apiKey: z.string().min(16).max(512).regex(/^[\x21-\x7e]+$/).optional(), model: z.string().regex(/^[a-zA-Z0-9._:-]{1,128}$/).optional() })).handler(async ({ input, context }) => {
      requireUser(context.user);
      const prefix = input.provider === 'openai' ? 'OPENAI' : 'ANTHROPIC';
      const key = input.apiKey ?? process.env[`${prefix}_API_KEY`];
      const model = input.model ?? process.env[`${prefix}_MODEL`] ?? DEFAULT_AGENT_MODELS[input.provider];
      if (!key)
        throw new ORPCError('PRECONDITION_FAILED', { message: 'Add your API key in the extension Agent settings.' });
      try {
        const request = checkedInput(input.input);
        const provider = hostedProvider(input.provider, { key, model });
        return { decision: await provider.decide(request, AbortSignal.any([AbortSignal.timeout(25000), ...(context.signal ? [context.signal] : [])])) };
      } catch (error) { throw new ORPCError('BAD_REQUEST', { message: error instanceof Error ? error.message : 'The agent could not choose an action.' }); }
    }),
  },
  auth: {
    register: base.input(credentials.extend({ name: z.string().trim().max(80).optional() }))
      .handler(async ({ input }) => {
        try { return await registerAccount(input.email, input.password, input.name); }
        catch (error) {
          if (error instanceof Error && error.message === 'EMAIL_EXISTS') {
            throw new ORPCError('CONFLICT', { message: 'An account already uses this email.' });
          }
          throw error;
        }
      }),
    login: base.input(credentials).handler(async ({ input }) => {
      try { return await loginAccount(input.email, input.password); }
      catch (error) {
        if (error instanceof Error && error.message === 'INVALID_CREDENTIALS') {
          throw new ORPCError('UNAUTHORIZED', { message: 'Invalid email or password.' });
        }
        throw error;
      }
    }),
    me: base.handler(async ({ context }) => ({ user: context.user })),
    logout: base.handler(async ({ context }) => {
      if (context.token) await revokeSession(context.token);
      return { ok: true as const };
    }),
  },
  skill: {
    list: base.handler(async ({ context }) => {
      const user = requireUser(context.user);
      return db().skill.findMany({
        where: { OR: [{ ownerId: user.id }, { shares: { some: { recipientId: user.id } } }] },
        select: { id: true, title: true, description: true, ownerId: true, currentVersion: true,
          updatedAt: true, owner: { select: { email: true, name: true } } },
        orderBy: { updatedAt: 'desc' },
      });
    }),
    get: base.input(id).handler(async ({ input, context }) => {
      const user = requireUser(context.user);
      const skill = await db().skill.findFirst({
        where: { id: input.id, OR: [{ ownerId: user.id }, { shares: { some: { recipientId: user.id } } }] },
        include: { owner: { select: { email: true, name: true } }, versions: { orderBy: { number: 'desc' } } },
      });
      if (!skill) throw new ORPCError('NOT_FOUND', { message: 'Skill not found.' });
      return skill;
    }),
    create: base.input(skillData).handler(async ({ input, context }) => {
      const user = requireUser(context.user);
      const markdown = checkedDocument(input);
      const plan = checkedPlan(markdown);
      return db().skill.create({ data: {
        ownerId: user.id, title: input.title, description: input.description,
        versions: { create: { number: 1, markdown, parameters: plan.parameters } },
      }, select: { id: true, currentVersion: true } });
    }),
    update: base.input(skillData.extend({ id: z.string().min(1) })).handler(async ({ input, context }) => {
      const user = requireUser(context.user);
      const markdown = checkedDocument(input);
      const plan = checkedPlan(markdown);
      return db().$transaction(async tx => {
        const updated = await tx.skill.updateMany({
          where: { id: input.id, ownerId: user.id },
          data: { title: input.title, description: input.description, currentVersion: { increment: 1 } },
        });
        if (updated.count !== 1) throw new ORPCError('NOT_FOUND', { message: 'Owned skill not found.' });
        const skill = await tx.skill.findUniqueOrThrow({ where: { id: input.id } });
        await tx.skillVersion.create({ data: {
          skillId: skill.id, number: skill.currentVersion, markdown, parameters: plan.parameters,
        } });
        return { id: skill.id, currentVersion: skill.currentVersion };
      });
    }),
    delete: base.input(id.extend({ version: z.number().int().positive(), confirm: z.literal(true) }))
      .handler(async ({ input, context }) => {
        const user = requireUser(context.user);
        return db().$transaction(async tx => {
          const skill = await tx.skill.findFirst({ where: { id: input.id, ownerId: user.id } });
          if (!skill) throw new ORPCError('NOT_FOUND', { message: 'Owned skill not found.' });
          if (skill.currentVersion !== input.version)
            throw new ORPCError('CONFLICT', { message: 'This skill changed. Reopen it and confirm deletion again.' });
          // Runs reference individual versions; remove their logs before cascading versions and shares.
          await tx.run.deleteMany({ where: { skillId: skill.id } });
          const removed = await tx.skill.deleteMany({ where: { id: skill.id, ownerId: user.id, currentVersion: input.version } });
          if (removed.count !== 1)
            throw new ORPCError('CONFLICT', { message: 'This skill changed. Reopen it and confirm deletion again.' });
          return { id: skill.id, deleted: true as const };
        });
      }),
    share: base.input(id.extend({ email: z.email().transform(value => value.toLowerCase()) }))
      .handler(async ({ input, context }) => {
        const user = requireUser(context.user);
        const skill = await db().skill.findFirst({ where: { id: input.id, ownerId: user.id } });
        if (!skill) throw new ORPCError('NOT_FOUND', { message: 'Owned skill not found.' });
        const recipient = await db().user.findUnique({ where: { email: input.email } });
        if (!recipient || recipient.id === user.id) {
          throw new ORPCError('BAD_REQUEST', { message: 'Choose another registered user.' });
        }
        await db().skillShare.upsert({
          where: { skillId_recipientId: { skillId: skill.id, recipientId: recipient.id } },
          update: {}, create: { skillId: skill.id, recipientId: recipient.id },
        });
        return { ok: true as const };
      }),
    unshare: base.input(id.extend({ email: z.email().transform(value => value.toLowerCase()) }))
      .handler(async ({ input, context }) => {
        const user = requireUser(context.user);
        const skill = await db().skill.findFirst({ where: { id: input.id, ownerId: user.id } });
        if (!skill) throw new ORPCError('NOT_FOUND', { message: 'Owned skill not found.' });
        const recipient = await db().user.findUnique({ where: { email: input.email } });
        if (recipient) await db().skillShare.deleteMany({ where: { skillId: skill.id, recipientId: recipient.id } });
        return { ok: true as const };
      }),
  },
  run: {
    start: base.input(z.object({ skillId: z.string().min(1), version: z.number().int().positive().optional() })).handler(async ({ input, context }) => {
      const user = requireUser(context.user);
      const skill = await db().skill.findFirst({
        where: { id: input.skillId, OR: [{ ownerId: user.id }, { shares: { some: { recipientId: user.id } } }] },
      });
      if (!skill) throw new ORPCError('NOT_FOUND', { message: 'Skill not found.' });
      const version = await db().skillVersion.findUnique({
        where: { skillId_number: { skillId: skill.id, number: input.version ?? skill.currentVersion } },
      });
      if (!version) throw new ORPCError('NOT_FOUND', { message: 'Skill version not found.' });
      const run = await db().run.create({ data: {
        skillId: skill.id, skillVersionId: version.id, userId: user.id, status: 'RUNNING',
      } });
      return { id: run.id, skillVersion: version.number };
    }),
    log: base.input(z.object({
      runId: z.string().min(1), stepNumber: z.number().int().positive(),
      kind: z.enum(['navigation', 'click', 'input', 'key']),
      status: z.enum(['done', 'blocked', 'confirmation-required']),
    })).handler(async ({ input, context }) => {
      const user = requireUser(context.user);
      return db().$transaction(async tx => {
        const run = await tx.run.findFirst({
          where: { id: input.runId, userId: user.id },
          include: { skillVersion: true, steps: { orderBy: { sequence: 'desc' }, take: 1 } },
        });
        if (!run || !['RUNNING', 'WAITING_CONFIRMATION'].includes(run.status)) {
          throw new ORPCError('NOT_FOUND', { message: 'Active run not found.' });
        }
        const plan = checkedPlan(run.skillVersion.markdown);
        if (plan.steps[input.stepNumber - 1]?.kind !== input.kind) {
          throw new ORPCError('BAD_REQUEST', { message: 'Step does not match the saved skill version.' });
        }
        const status = input.status === 'done' ? 'DONE' : input.status === 'blocked' ? 'BLOCKED' : 'CONFIRMATION_REQUIRED';
        const step = await tx.stepLog.create({ data: {
          runId: run.id, sequence: (run.steps[0]?.sequence ?? 0) + 1,
          stepNumber: input.stepNumber, kind: input.kind, status,
        } });
        await tx.run.update({ where: { id: run.id }, data: {
          status: input.status === 'confirmation-required' ? 'WAITING_CONFIRMATION'
            : input.status === 'done' && input.stepNumber === plan.steps.length ? 'COMPLETED' : 'RUNNING',
          ...(input.status === 'done' && input.stepNumber === plan.steps.length ? { finishedAt: new Date() } : {}),
        } });
        return { sequence: step.sequence };
      });
    }),
    stop: base.input(z.object({ runId: z.string().min(1) })).handler(async ({ input, context }) => {
      const user = requireUser(context.user);
      const updated = await db().run.updateMany({
        where: { id: input.runId, userId: user.id, status: { in: ['RUNNING', 'WAITING_CONFIRMATION'] } },
        data: { status: 'STOPPED', finishedAt: new Date() },
      });
      return { stopped: updated.count === 1 };
    }),
    list: base.handler(async ({ context }) => {
      const user = requireUser(context.user);
      return db().run.findMany({
        where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 50,
        include: { skill: { select: { title: true } }, steps: { orderBy: { sequence: 'asc' } } },
      });
    }),
  },
};
