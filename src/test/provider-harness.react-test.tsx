import { createContext, type PropsWithChildren, useContext, useEffect, useState } from 'react';

import { renderProviderHarness } from './provider-harness';

it('observes context updates, rerenders props, flushes async work, and unmounts cleanup', async () => {
  const cleanup = jest.fn();
  const Context = createContext(-1);

  function Provider({ seed, children }: PropsWithChildren<{ seed: number }>) {
    const [value, setValue] = useState(0);
    useEffect(() => {
      let active = true;
      void Promise.resolve().then(() => { if (active) setValue(seed); });
      return () => { active = false; cleanup(seed); };
    }, [seed]);
    return <Context.Provider value={value}>{children}</Context.Provider>;
  }

  const harness = renderProviderHarness({ Provider, useValue: () => useContext(Context), props: { seed: 3 } });
  expect(harness.value()).toBe(0);
  await harness.flush();
  expect(harness.value()).toBe(3);

  await harness.rerender({ seed: 7 });
  await harness.flush();
  expect(harness.value()).toBe(7);
  expect(cleanup).toHaveBeenCalledWith(3);

  await harness.unmount();
  expect(cleanup).toHaveBeenLastCalledWith(7);
});
