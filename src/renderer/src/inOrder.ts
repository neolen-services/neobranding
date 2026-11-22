// Runs jobs several at a time while keeping the order that matters: a job that
// depends on another waits for it. Storyboards and clips are made this way, so
// scenes that do not lean on each other are not made to queue.

/** How many pictures or clips are asked for at the same time. */
export const AT_ONCE = 3;

/**
 * Runs `work` for every item. `dependsOn` names the item that must finish first
 * (or undefined); it only matters when that item is also in the list. `work`
 * returns false when it failed: nothing new is started after that, and what
 * depended on it is left undone. Resolves with how many succeeded.
 */
export async function inOrder(items: number[], dependsOn: (item: number) => number | undefined, work: (item: number) => Promise<boolean>, atOnce = AT_ONCE): Promise<number> {
  const waiting = new Set(items);
  const running = new Map<number, Promise<void>>();
  let done = 0;
  let failed = false;
  while ((waiting.size > 0 && !failed) || running.size > 0) {
    if (!failed) {
      for (const item of [...waiting]) {
        if (running.size >= atOnce) break;
        const first = dependsOn(item);
        if (first !== undefined && (waiting.has(first) || running.has(first))) continue;
        waiting.delete(item);
        running.set(
          item,
          work(item)
            .then((ok) => {
              if (ok) done++;
              else failed = true;
            })
            .catch(() => {
              failed = true;
            })
            .finally(() => {
              running.delete(item);
            }),
        );
      }
    }
    // Nothing can start and nothing is running: what is left depends on something that will never finish.
    if (running.size === 0) break;
    await Promise.race(running.values());
  }
  return done;
}
