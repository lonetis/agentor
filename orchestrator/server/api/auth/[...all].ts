import { useAuth } from '../../utils/auth';

export default defineEventHandler(async (event) => {
  const auth = useAuth();
  return auth.handler(toWebRequest(event));
});
