import { lazyScreen } from '../../../core/ui/lazy-screen';

/** Driver/Partner route (P2.8): the screen module loads only when this route is opened, never for riders at start-up. */
export default lazyScreen(() => import('../../../features/driver/screens/RenewalScreen'));
