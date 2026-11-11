// Feature module wiring. Each module exports register() from its index.ts.
import { register as contents } from './contents';
import { register as symbology } from './symbology';
import { register as table } from './table';
import { register as gp } from './gp';
import { register as io } from './io';
import { register as navigate } from './navigate';
import { register as editing } from './editing';
import { register as layout } from './layout';
import { register as charts } from './charts';

export function registerFeatures() {
  for (const [name, fn] of Object.entries({ navigate, contents, io, symbology, table, gp, editing, layout, charts })) {
    try {
      fn();
    } catch (err) {
      console.error(`Feature module "${name}" failed to register`, err);
    }
  }
}
