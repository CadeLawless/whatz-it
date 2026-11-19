import { act, render } from '@testing-library/react-native';
import type { ComponentType, PropsWithChildren, ReactElement } from 'react';

type ProviderHarnessOptions<T, P extends object> = {
  Provider: ComponentType<PropsWithChildren<P>>;
  useValue: () => T;
  props: P;
  children?: ReactElement;
};

export function renderProviderHarness<T, P extends object>({
  Provider,
  useValue,
  props,
  children,
}: ProviderHarnessOptions<T, P>) {
  let latestValue: T | undefined;

  function ContextProbe() {
    latestValue = useValue();
    return null;
  }

  const element = (nextProps: P) => (
    <Provider {...nextProps}>
      <ContextProbe />
      {children}
    </Provider>
  );
  const rendered = render(element(props));

  return {
    value(): T {
      if (latestValue === undefined) throw new Error('Provider context has not rendered');
      return latestValue;
    },
    async flush() {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    },
    async rerender(nextProps: P) {
      await act(async () => rendered.rerender(element(nextProps)));
    },
    async unmount() {
      await act(async () => rendered.unmount());
    },
  };
}
