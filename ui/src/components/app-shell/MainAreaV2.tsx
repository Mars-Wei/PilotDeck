import { useState } from 'react';
import type { AlwaysOnSubTab, AppTab, Project, ProjectSession } from '../../types/app';
import MainContent from '../main-content/view/MainContent';
import type { MainContentProps } from '../main-content/types/types';

// V2 main shell: global chrome lives in HomeChrome, while MainContent owns the
// active workspace/page surface. The old per-project top tab bar is intentionally
// not rendered here.
type MainAreaV2Props = MainContentProps & {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  activeTab: AppTab;
  isSidebarCollapsed?: boolean;
  onOpenSidebar?: () => void;
};

export default function MainAreaV2(props: MainAreaV2Props) {
  const [alwaysOnSubTab, setAlwaysOnSubTab] = useState<AlwaysOnSubTab>('dashboard');

  return (
    <div className="flex h-full min-w-0 flex-col bg-surface-50 text-surface-900 dark:bg-surface-950 dark:text-surface-100">
      <div className="min-h-0 flex-1 overflow-hidden">
        <MainContent
          {...props}
          alwaysOnSubTab={alwaysOnSubTab}
          onAlwaysOnSubTabChange={setAlwaysOnSubTab}
        />
      </div>
    </div>
  );
}
