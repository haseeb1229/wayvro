import { lazy, Suspense, type ComponentType } from 'react';
import { Screen, StateView } from './primitives';

/**
 * A route screen whose module is evaluated only when the route is first opened (P2.8). Expo Router registers every
 * route at start-up, so a route file that imported a Driver/Partner screen directly would evaluate camera, image
 * picker and file-system modules for every rider. Route files wrap such screens with `lazyScreen(() => import(…))`.
 */
export function lazyScreen(load: () => Promise<{ readonly default: ComponentType }>): ComponentType {
  const Lazy = lazy(load);
  return function LazyScreen() {
    return (
      <Suspense
        fallback={
          <Screen scroll={false}>
            <StateView state={{ kind: 'loading' }} emptyKey="common.loading" onRetry={noop} />
          </Screen>
        }
      >
        <Lazy />
      </Suspense>
    );
  };
}

const noop = (): void => undefined;
