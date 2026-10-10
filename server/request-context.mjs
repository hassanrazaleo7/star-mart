import { AsyncLocalStorage } from 'node:async_hooks';
const context = new AsyncLocalStorage();
export const withRequestContext = fn => context.run({ actor: 'Store operation' }, fn);
export const setActor = value => {
  const current = context.getStore();
  if (current) current.actor = String(value).slice(0, 200);
};
export const currentActor = () => context.getStore()?.actor || 'Store operation';
