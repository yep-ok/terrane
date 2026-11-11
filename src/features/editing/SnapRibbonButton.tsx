// Ribbon split button for snapping (subscribes to editing state so it stays in sync).
import { ChevronDown, Magnet } from 'lucide-react';
import { runCommand } from '../../core/registry';
import { cx, openMenuAt } from '../../ui/kit';
import { useEdit } from './state';

const TOLERANCES = [5, 10, 15, 20, 30];

export function SnapRibbonButton() {
  const on = useEdit((s) => s.snapping);
  const tol = useEdit((s) => s.snapTolerance);
  return (
    <div className="rb-split small">
      <button
        type="button"
        className={cx('rb', 'small', 'face', on && 'pressed')}
        title={`Snapping (F9)\nSnap to vertices and edges of visible layers within ${tol} px.`}
        onClick={() => runCommand('edit.snapping')}
      >
        <Magnet className="ico" />
        <span>Snapping</span>
      </button>
      <button
        type="button"
        className="rb small arrow"
        title="Snapping options"
        onClick={(e) =>
          openMenuAt(e.currentTarget.parentElement!, [
            { label: 'Snapping', checked: on, onClick: () => runCommand('edit.snapping') },
            'separator',
            ...TOLERANCES.map((px) => ({ label: `Tolerance ${px} px`, checked: tol === px, onClick: () => runCommand('edit.snapTolerance', px) })),
          ])
        }
      >
        <ChevronDown className="chev" />
      </button>
    </div>
  );
}
