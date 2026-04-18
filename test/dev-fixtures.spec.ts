import { DEV_FIXTURE_IDS, DEV_UI_FIXTURE_SCENARIOS, buildDevFixturePlan } from '../prisma/dev-fixtures';

describe('Development UI fixtures', () => {
  it('defines the required scenario accounts for .pen verification', () => {
    expect(Object.keys(DEV_UI_FIXTURE_SCENARIOS)).toEqual([
      'default_populated_user',
      'empty_user',
      'leader_user',
      'member_user',
      'recruiting_heavy_user',
      'profile_connected_user',
    ]);
  });

  it('builds populated and empty states with deterministic fixture ids', () => {
    const anchor = new Date('2026-04-18T00:00:00.000Z');
    const plan = buildDevFixturePlan(anchor);

    expect(plan.groups.map((group) => group.id)).toEqual(
      expect.arrayContaining([
        DEV_FIXTURE_IDS.groups.publicClash,
        DEV_FIXTURE_IDS.groups.privateNight,
        DEV_FIXTURE_IDS.groups.teamLab,
      ]),
    );
    expect(plan.matches.map((match) => match.id)).toEqual(
      expect.arrayContaining([
        DEV_FIXTURE_IDS.matches.publicUpcoming,
        DEV_FIXTURE_IDS.matches.privateBalanced,
        DEV_FIXTURE_IDS.matches.publicConfirmed,
        DEV_FIXTURE_IDS.matches.publicPending,
      ]),
    );
    expect(plan.recruitingPosts.map((post) => post.id)).toEqual(
      expect.arrayContaining([
        DEV_FIXTURE_IDS.recruitingPosts.publicMid,
        DEV_FIXTURE_IDS.recruitingPosts.privateSupport,
      ]),
    );

    expect(plan.groupMembers.map((member) => member.userId)).not.toContain(
      DEV_FIXTURE_IDS.users.empty,
    );
    expect(plan.riotAccounts.map((account) => account.userId)).not.toContain(
      DEV_FIXTURE_IDS.users.empty,
    );
    expect(plan.powerProfiles.map((profile) => profile.userId)).not.toContain(
      DEV_FIXTURE_IDS.users.empty,
    );
  });

  it('keeps upcoming fixtures in the future and recent fixtures in the past', () => {
    const anchor = new Date('2026-04-18T00:00:00.000Z');
    const plan = buildDevFixturePlan(anchor);

    const publicUpcoming = plan.matches.find(
      (match) => match.id === DEV_FIXTURE_IDS.matches.publicUpcoming,
    );
    const privateBalanced = plan.matches.find(
      (match) => match.id === DEV_FIXTURE_IDS.matches.privateBalanced,
    );
    const publicConfirmed = plan.matches.find(
      (match) => match.id === DEV_FIXTURE_IDS.matches.publicConfirmed,
    );
    const pendingResult = plan.results.find(
      (result) => result.id === DEV_FIXTURE_IDS.results.publicPending,
    );

    expect(publicUpcoming?.scheduledAt.getTime()).toBeGreaterThan(anchor.getTime());
    expect(privateBalanced?.scheduledAt.getTime()).toBeGreaterThan(anchor.getTime());
    expect(publicConfirmed?.scheduledAt.getTime()).toBeLessThan(anchor.getTime());
    expect(pendingResult?.resultStatus).toBe('PARTIAL');
  });
});
