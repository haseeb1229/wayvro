import { lazyScreen } from '../../../core/ui/lazy-screen';

/** P2.9 account security route: loaded only when opened. */
export default lazyScreen(() => import('../../../features/account/security/DeletionScreen'));
