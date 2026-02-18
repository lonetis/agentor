import { useGitHubService } from '../../utils/services';

export default defineEventHandler(async (event) => {
  const body = await readBody<{ owner: string; name: string; private: boolean }>(event);

  if (!body.owner || !body.name) {
    throw createError({ statusCode: 400, statusMessage: 'Missing owner or name' });
  }

  const github = useGitHubService();

  if (!github.hasToken) {
    throw createError({ statusCode: 400, statusMessage: 'GitHub token not configured' });
  }

  const repo = await github.createRepo(body.owner, body.name, body.private ?? false);
  return { repo };
});
