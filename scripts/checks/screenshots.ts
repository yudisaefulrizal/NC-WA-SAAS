// Screenshots of the browser checks, for a person to look at afterwards. Kept outside the project, in the system
// temporary directory, and replaced by each run.
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export const screenshots=join(tmpdir(),'ncwa-browser-check');
