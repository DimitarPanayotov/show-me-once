import { ORPCError, os } from '@orpc/server';
import { parseSkillPlan } from '@show-me-once/shared';
import { z } from 'zod';
import { loginAccount, registerAccount, revokeSession } from './auth';
import { db } from './db';

type Identity = { id: string; email: string; name: string | null };
type Context = { user: Identity | null; token: string | null };
const base = os.$context<Context>();

function requireUser(user: Identity | null): Identity {
  if (!user) throw new ORPCError('UNAUTHORIZED', { message: 'Sign in first.' });
  return user;
}

function checkedPlan(markdown: string) {
  try { return parseSkillPlan(markdown); }
  catch { throw new ORPCError('BAD_REQUEST', { message: 'The SKILL.md executable plan is invalid or unsafe.' }); }
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
      const plan = checkedPlan(input.markdown);
      return db().skill.create({ data: {
        ownerId: user.id, title: input.title, description: input.description,
        versions: { create: { number: 1, markdown: input.markdown, parameters: plan.parameters } },
      }, select: { id: true, currentVersion: true } });
    }),
    update: base.input(skillData.extend({ id: z.string().min(1) })).handler(async ({ input, context }) => {
      const user = requireUser(context.user);
      const plan = checkedPlan(input.markdown);
      return db().$transaction(async tx => {
        const updated = await tx.skill.updateMany({
          where: { id: input.id, ownerId: user.id },
          data: { title: input.title, description: input.description, currentVersion: { increment: 1 } },
        });
        if (updated.count !== 1) throw new ORPCError('NOT_FOUND', { message: 'Owned skill not found.' });
        const skill = await tx.skill.findUniqueOrThrow({ where: { id: input.id } });
        await tx.skillVersion.create({ data: {
          skillId: skill.id, number: skill.currentVersion, markdown: input.markdown, parameters: plan.parameters,
        } });
        return { id: skill.id, currentVersion: skill.currentVersion };
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
    start: base.input(z.object({ skillId: z.string().min(1) })).handler(async ({ input, context }) => {
      const user = requireUser(context.user);
      const skill = await db().skill.findFirst({
        where: { id: input.skillId, OR: [{ ownerId: user.id }, { shares: { some: { recipientId: user.id } } }] },
      });
      if (!skill) throw new ORPCError('NOT_FOUND', { message: 'Skill not found.' });
      const version = await db().skillVersion.findUnique({
        where: { skillId_number: { skillId: skill.id, number: skill.currentVersion } },
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
