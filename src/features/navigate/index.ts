// navigate module: navigation, selection and inquiry tools.
import './navigate.css';
import { registerExploreTool } from './explore';
import { registerSelectionCommands, registerSelectionTools } from './selection';
import { registerMeasure } from './measure';
import { registerHistoryPlugin, registerNavigationCommands } from './navigation';
import { registerNavDialogs } from './dialogs';
import { registerCrsDialog } from './crsdialog';
import { registerByLocation } from './bylocation';
import { registerLocate } from './locate';
import { registerContextMenu } from './contextmenu';
import { registerNavigateRibbon } from './ribbon';

export function register() {
  registerExploreTool();
  registerSelectionTools();
  registerSelectionCommands();
  registerByLocation();
  registerMeasure();
  registerNavigationCommands();
  registerHistoryPlugin();
  registerNavDialogs();
  registerCrsDialog();
  registerLocate();
  registerContextMenu();
  registerNavigateRibbon();
}
