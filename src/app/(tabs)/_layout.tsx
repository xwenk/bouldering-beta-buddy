/**
 * The tab bar. Everything under this folder is a tab; anything that opens on
 * top of one, like a gym or a route, lives outside it and is pushed by the
 * stack in the root layout.
 */
import AppTabs from '@/components/app-tabs';

export default function TabsLayout() {
  return <AppTabs />;
}
