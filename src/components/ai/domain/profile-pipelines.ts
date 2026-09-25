// Pipeline yang dijalankan untuk setiap profil, dan batas panjang FAQ per profil.
import { type Pipeline } from './pipeline/runner.js';
import { csPipeline } from './profiles/cs/pipeline.js';
import { eduPipeline } from './profiles/pendidikan/pipeline.js';
import { eduLimits } from './profiles/pendidikan/profile.js';
import { testerPipeline } from './profiles/tester/pipeline.js';

export const pipelines: Record<string, Pipeline> = { cs: csPipeline, pendidikan: eduPipeline, tester: testerPipeline };
export const faqLimit = (type: string) => (type === 'pendidikan' ? eduLimits.faq : 2000);
