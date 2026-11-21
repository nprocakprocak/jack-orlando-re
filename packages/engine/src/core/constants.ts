// Timing and input constants of the original engine.

/** Global tick period: Timer_Init -> timeSetEvent(5, 1, Timer_TickCallback, 5, PERIODIC). */
export const TICK_MS = 5;

/**
 * Game_TimerTick runs on every 5 ms tick (timer slot 1) and executes the
 * logic body (countdowns) on every 3rd call: `if (2 < counter) { counter = 0; ... }`.
 */
export const LOGIC_TICK_DIVIDER = 3;

/** Logic tick period in ms (3 x 5 ms). */
export const LOGIC_TICK_MS = TICK_MS * LOGIC_TICK_DIVIDER;

/**
 * Game_TimerTick: the logic body sits in a `while (true)` that only breaks when
 * the counter (incremented after each body) is < 11; on reaching 11 the counter
 * is reset and the body runs once more. The extra body increments the counter too (to 1),
 * so the first double run is on the 11th logic tick and then on every 10th: in steady
 * state 11 bodies per 10 x 15 ms (~13.64 ms per body, ~73.3 Hz). Assumes the counter
 * starts at 0.
 */
export const LOGIC_EXTRA_EVERY = 11;

/**
 * g_frameMinMs = 5, passed to Timer_WaitSinceFrameStart at the end of
 * every game frame. The wait lasts until `ticks - frameStartTick > ms / 5`, i.e. at least
 * 2 ticks after the frame started (5-10 ms of real time). ms / 5 == 0 disables the wait.
 */
export const FRAME_MIN_MS = 5;

/** Input_Init -> Timer_Start(4, 40 ms, Input_Poll, thread): keyboard buffer read period. */
export const INPUT_POLL_MS = 40;

/** Input_InitKeyboard: DIPROP_BUFFERSIZE = 0x10 buffered keyboard events. */
export const KEY_BUFFER_SIZE = 16;

/** Visible screen (Video_SetMode: 640x480x16). */
export const SCREEN_WIDTH = 640;
export const SCREEN_HEIGHT = 480;

/** Off-screen work buffer used for scrolling scenes (Video_SetMode: 1024x480). */
export const WORK_BUFFER_WIDTH = 1024;
export const WORK_BUFFER_HEIGHT = 480;
