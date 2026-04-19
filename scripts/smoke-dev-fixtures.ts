import axios, { AxiosInstance } from 'axios';

import { DEV_FIXTURE_IDS, DEV_UI_FIXTURE_SCENARIOS, resolveDevFixturePassword } from '../prisma/dev-fixtures';

type ScenarioName = keyof typeof DEV_UI_FIXTURE_SCENARIOS;
const REQUIRED_LANES = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'] as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertPowerProfileContract(data: any, label: string): void {
  assert(Number(data?.overallPower) > 0, `${label} overallPower should be populated`);
  assert(typeof data?.primaryPosition === 'string', `${label} primaryPosition should be populated`);
  assert(typeof data?.secondaryPosition === 'string', `${label} secondaryPosition should be populated`);
  assert(typeof data?.style?.stability === 'number', `${label} style.stability should be populated`);
  assert(typeof data?.style?.roleFocus === 'string', `${label} style.roleFocus should be populated`);

  for (const lane of REQUIRED_LANES) {
    assert(
      typeof data?.lanePower?.[lane] === 'number',
      `${label} lanePower.${lane} should be populated`,
    );
  }
}

async function login(client: AxiosInstance, email: string, password: string): Promise<string> {
  const response = await client.post('/auth/login/email', { email, password });
  assert(response.status === 200, `login failed for ${email}`);
  assert(typeof response.data?.accessToken === 'string', `missing access token for ${email}`);
  return response.data.accessToken;
}

async function get(
  client: AxiosInstance,
  path: string,
  token?: string,
): Promise<{ status: number; data: any }> {
  const response = await client.get(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    validateStatus: () => true,
  });
  return { status: response.status, data: response.data };
}

async function runDefaultScenario(client: AxiosInstance, password: string): Promise<void> {
  const scenario = DEV_UI_FIXTURE_SCENARIOS.default_populated_user;
  const token = await login(client, scenario.email, password);

  const me = await get(client, '/users/me', token);
  assert(me.status === 200, 'default user /users/me should return 200');
  assert(me.data.id === scenario.userId, 'default user id mismatch');

  const riotAccounts = await get(client, '/riot-accounts', token);
  assert(riotAccounts.status === 200, 'default user riot account list should return 200');
  assert(Array.isArray(riotAccounts.data.items) && riotAccounts.data.items.length >= 1, 'default user should have at least one riot account');

  const selfPower = await get(client, `/users/${scenario.userId}/power-profile`, token);
  assert(selfPower.status === 200, 'default user power profile should return 200');
  assertPowerProfileContract(selfPower.data, 'default user power profile');

  const sharedPower = await get(client, `/users/${DEV_FIXTURE_IDS.users.profile}/power-profile`, token);
  assert(sharedPower.status === 200, 'shared group profile power lookup should return 200');
  assertPowerProfileContract(sharedPower.data, 'shared group power profile');

  const stats = await get(client, `/users/${scenario.userId}/stats`, token);
  assert(stats.status === 200, 'default user stats should return 200');
  assert(Number(stats.data.totalGames) >= 2, 'default user stats should include confirmed games');

  const history = await get(client, `/users/${scenario.userId}/inhouse-history`, token);
  assert(history.status === 200, 'default user inhouse history should return 200');
  assert(Array.isArray(history.data.items) && history.data.items.length >= 2, 'default user history should be populated');

  const notifications = await get(client, '/notifications', token);
  assert(notifications.status === 200, 'default user notifications should return 200');
  assert(Array.isArray(notifications.data.items) && notifications.data.items.length >= 1, 'default user should have notifications');

  const publicGroups = await get(client, '/groups/public');
  assert(publicGroups.status === 200, 'public groups should return 200');
  const publicGroupIds = Array.isArray(publicGroups.data.items)
    ? publicGroups.data.items.map((item: any) => item.id)
    : [];
  assert(publicGroupIds.includes(DEV_FIXTURE_IDS.groups.publicClash), 'public group list should include public clash group');
  assert(publicGroupIds.includes(DEV_FIXTURE_IDS.groups.teamLab), 'public group list should include team lab group');

  const publicGroupDetail = await get(client, `/groups/${DEV_FIXTURE_IDS.groups.publicClash}`, token);
  assert(publicGroupDetail.status === 200, 'public clash detail should return 200');

  const privateGroupDetail = await get(client, `/groups/${DEV_FIXTURE_IDS.groups.privateNight}`, token);
  assert(privateGroupDetail.status === 200, 'private night detail should return 200 for default member');

  const members = await get(client, `/groups/${DEV_FIXTURE_IDS.groups.publicClash}/members`, token);
  assert(members.status === 200, 'public clash members should return 200');
  assert(Array.isArray(members.data.items) && members.data.items.length >= 5, 'public clash members should be populated');

  const leaderboard = await get(client, `/groups/${DEV_FIXTURE_IDS.groups.publicClash}/leaderboard`, token);
  assert(leaderboard.status === 200, 'public clash leaderboard should return 200');
  assert(Array.isArray(leaderboard.data.items) && leaderboard.data.items.length >= 5, 'public clash leaderboard should be populated');

  const recentMatches = await get(client, `/groups/${DEV_FIXTURE_IDS.groups.publicClash}/matches/recent`, token);
  assert(recentMatches.status === 200, 'public clash recent matches should return 200');
  const recentMatchIds = Array.isArray(recentMatches.data.items)
    ? recentMatches.data.items.map((item: any) => item.matchId)
    : [];
  assert(recentMatchIds.includes(DEV_FIXTURE_IDS.matches.publicUpcoming), 'recent matches should include upcoming public match');
  assert(recentMatchIds.includes(DEV_FIXTURE_IDS.matches.publicConfirmed), 'recent matches should include confirmed public match');

  const publicRecruiting = await get(client, '/recruiting-posts/public');
  assert(publicRecruiting.status === 200, 'public recruiting should return 200');
  const publicRecruitingIds = Array.isArray(publicRecruiting.data.items)
    ? publicRecruiting.data.items.map((item: any) => item.id)
    : [];
  assert(publicRecruitingIds.includes(DEV_FIXTURE_IDS.recruitingPosts.publicMid), 'public recruiting should include open public post');

  const privateRecruitingDetail = await get(client, `/recruiting-posts/${DEV_FIXTURE_IDS.recruitingPosts.privateSupport}`, token);
  assert(privateRecruitingDetail.status === 200, 'private recruiting detail should return 200 for private group member');

  const matchSummary = await get(client, `/matches/${DEV_FIXTURE_IDS.matches.publicConfirmed}/summary`, token);
  assert(matchSummary.status === 200, 'match summary should return 200');
  assert(Array.isArray(matchSummary.data.teamA) && matchSummary.data.teamA.length === 5, 'match summary teamA should contain 5 players');
  assert(Array.isArray(matchSummary.data.teamB) && matchSummary.data.teamB.length === 5, 'match summary teamB should contain 5 players');

  const matchResult = await get(client, `/matches/${DEV_FIXTURE_IDS.matches.publicPending}/results`, token);
  assert(matchResult.status === 200, 'pending match result should return 200');
  assert(matchResult.data.resultStatus === 'PARTIAL', 'pending match result should be partial');
}

async function runLeaderScenario(client: AxiosInstance, password: string): Promise<void> {
  const scenario = DEV_UI_FIXTURE_SCENARIOS.leader_user;
  const token = await login(client, scenario.email, password);

  const privateGroupDetail = await get(client, `/groups/${DEV_FIXTURE_IDS.groups.privateNight}`, token);
  assert(privateGroupDetail.status === 200, 'leader should access private group detail');

  const applicants = await get(
    client,
    `/recruiting-posts/${DEV_FIXTURE_IDS.recruitingPosts.privateSupport}/applicants`,
    token,
  );
  assert(applicants.status === 200, 'leader should access private recruiting applicants');
  assert(Array.isArray(applicants.data.items) && applicants.data.items.length >= 2, 'private recruiting applicants should be populated');
}

async function runEmptyScenario(client: AxiosInstance, password: string): Promise<void> {
  const scenario = DEV_UI_FIXTURE_SCENARIOS.empty_user;
  const token = await login(client, scenario.email, password);

  const me = await get(client, '/users/me', token);
  assert(me.status === 200, 'empty user /users/me should return 200');
  assert(me.data.id === scenario.userId, 'empty user id mismatch');

  const riotAccounts = await get(client, '/riot-accounts', token);
  assert(riotAccounts.status === 200, 'empty user riot account list should return 200');
  assert(Array.isArray(riotAccounts.data.items) && riotAccounts.data.items.length === 0, 'empty user should have no riot accounts');

  const power = await get(client, `/users/${scenario.userId}/power-profile`, token);
  assert(power.status === 404, 'empty user power profile should return 404');

  const stats = await get(client, `/users/${scenario.userId}/stats`, token);
  assert(stats.status === 200, 'empty user stats should return 200');
  assert(Number(stats.data.totalGames) === 0, 'empty user stats should be empty');

  const history = await get(client, `/users/${scenario.userId}/inhouse-history`, token);
  assert(history.status === 200, 'empty user history should return 200');
  assert(Array.isArray(history.data.items) && history.data.items.length === 0, 'empty user history should be empty');

  const notifications = await get(client, '/notifications', token);
  assert(notifications.status === 200, 'empty user notifications should return 200');
  assert(Array.isArray(notifications.data.items) && notifications.data.items.length === 0, 'empty user notifications should be empty');

  const recruiting = await get(client, '/recruiting-posts', token);
  assert(recruiting.status === 200, 'empty user recruiting list should return 200');
  assert(Array.isArray(recruiting.data.items) && recruiting.data.items.length >= 1, 'empty user should still see public recruiting posts');
}

async function main(): Promise<void> {
  const baseURL = process.env.SMOKE_BASE_URL ?? process.env.BASE_URL ?? 'http://localhost:3000';
  const password = resolveDevFixturePassword();
  const client = axios.create({
    baseURL,
    validateStatus: () => true,
  });

  const requested = process.argv.slice(2) as ScenarioName[];
  const scenarios =
    requested.length > 0
      ? requested
      : (['default_populated_user', 'leader_user', 'empty_user'] as ScenarioName[]);

  for (const scenario of scenarios) {
    assert(
      scenario in DEV_UI_FIXTURE_SCENARIOS,
      `unknown scenario "${scenario}". Available: ${Object.keys(DEV_UI_FIXTURE_SCENARIOS).join(', ')}`,
    );
  }

  for (const scenario of scenarios) {
    if (scenario === 'default_populated_user') {
      await runDefaultScenario(client, password);
      // eslint-disable-next-line no-console
      console.log(`[smoke] ${scenario} passed`);
      continue;
    }

    if (scenario === 'leader_user') {
      await runLeaderScenario(client, password);
      // eslint-disable-next-line no-console
      console.log(`[smoke] ${scenario} passed`);
      continue;
    }

    if (scenario === 'empty_user') {
      await runEmptyScenario(client, password);
      // eslint-disable-next-line no-console
      console.log(`[smoke] ${scenario} passed`);
      continue;
    }

    // eslint-disable-next-line no-console
    console.log(`[smoke] ${scenario} skipped: no dedicated smoke flow defined`);
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[smoke] failed', error instanceof Error ? error.message : error);
  process.exit(1);
});
