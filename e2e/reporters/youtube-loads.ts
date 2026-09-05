/**
 * How many video pages a run loaded, per file and in total.
 *
 * The suite runs against a real person's account, so the number of pages it
 * asks YouTube for is a cost worth watching — and a claim about that number has
 * to be measured. Counting `ext.open` calls in the source cannot see a call
 * inside a branch, a check that skipped, or a retry.
 *
 * Retries ARE included, deliberately: a retried check loaded the page again,
 * and YouTube served it again. A figure that quietly dropped them would flatter
 * exactly the runs that cost the most.
 */
import type { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter';

export default class YoutubeLoadsReporter implements Reporter {
    private byFile = new Map<string, number>();
    private total = 0;

    onTestEnd(test: TestCase, result: TestResult): void {
        const annotation = result.annotations.find((a) => a.type === 'youtube-loads');
        const spent = Number(annotation?.description ?? 0);
        if (!Number.isFinite(spent) || spent === 0) return;
        const file = test.location.file.split('/').pop() ?? test.location.file;
        this.byFile.set(file, (this.byFile.get(file) ?? 0) + spent);
        this.total += spent;
    }

    onEnd(_result: FullResult): void {
        // Silence when nothing was counted: a run of unit-shaped checks that
        // never opened a video should not print an empty table.
        if (this.total === 0) return;
        const lines = [...this.byFile.entries()].sort((a, b) => b[1] - a[1]);
        process.stdout.write('\n');
        for (const [file, n] of lines) {
            process.stdout.write(`youtube loads  ${String(n).padStart(3)}  ${file}\n`);
        }
        process.stdout.write(`youtube loads  ${String(this.total).padStart(3)}  TOTAL (retries included)\n`);
    }
}
