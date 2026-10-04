// Content script for every web page: marks the learner's saved words in the
// page text. Imported by path, not through the package barrel, so this bundle
// carries the highlighter and nothing of the subtitle UI.
import { installPageHighlight } from '../../../../packages/shared/src/page-highlight';

void installPageHighlight();
