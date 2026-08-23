import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import type { ReactNode } from 'react';

export interface TabItem {
  content: ReactNode;
  label: string;
  value: string;
}

export const Tabs = ({ items }: { items: readonly TabItem[] }) => (
  <BaseTabs.Root className="ui-tabs" defaultValue={items[0]?.value}>
    <BaseTabs.List className="ui-tabs-list">
      {items.map((item) => (
        <BaseTabs.Tab className="ui-tab" key={item.value} value={item.value}>
          {item.label}
        </BaseTabs.Tab>
      ))}
      <BaseTabs.Indicator className="ui-tabs-indicator" />
    </BaseTabs.List>
    {items.map((item) => (
      <BaseTabs.Panel
        className="ui-tabs-panel"
        key={item.value}
        value={item.value}
      >
        {item.content}
      </BaseTabs.Panel>
    ))}
  </BaseTabs.Root>
);
