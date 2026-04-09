import { useAuth } from '../../utils/auth';

export default defineEventHandler(async (event) => {
  const auth = useAuth() as any;
  return auth.handler(toWebRequest(event));
});
