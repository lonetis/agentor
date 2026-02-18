import { useGitHubService } from '../../utils/services';

export default defineEventHandler(async () => {
  const github = useGitHubService();

  if (!github.hasToken) {
    return { repos: [], tokenConfigured: false, username: '', orgs: [] as string[] };
  }

  try {
    const [repos, user, orgs] = await Promise.all([
      github.listRepos(),
      github.getUser(),
      github.listOrgs(),
    ]);
    return { repos, tokenConfigured: true, username: user.login, orgs };
  } catch {
    return { repos: [], tokenConfigured: false, username: '', orgs: [] as string[] };
  }
});
