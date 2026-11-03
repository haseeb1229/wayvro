import { lazyScreen } from '../../../core/ui/lazy-screen';

/** Driver/Partner home (readiness): the screen module loads only when this route is opened. */
export default lazyScreen(() => import('../../../features/driver/screens/DriveHomeScreen'));
