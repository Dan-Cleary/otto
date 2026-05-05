import type { CSSProperties, ReactNode } from "react";

export type OttoState = "idle" | "thinking" | "done" | "error";

const SPRITE_URL: Record<OttoState, string> = {
  idle: "/otto/sprites/otter-idle.svg",
  thinking: "/otto/sprites/otter-thinking.svg",
  done: "/otto/sprites/otter-done.svg",
  error: "/otto/sprites/otter-error.svg",
};

/**
 * The otter sprite — Otto's character. 24×24 pixel art, render at integer
 * scales (24, 48, 72, …). Rendered with `image-rendering: pixelated`.
 */
export function OttoSprite({
  size = 48,
  state = "idle",
  className,
  style,
}: {
  size?: number;
  state?: OttoState;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <img
      src={SPRITE_URL[state]}
      width={size}
      height={size}
      alt={`otto · ${state}`}
      className={`otto-sprite otto-sprite-${state} ${className ?? ""}`}
      style={style}
      draggable={false}
    />
  );
}

/**
 * Hero placement — the sprite at large scale with an optional caption.
 * Used in empty states and the login screen.
 */
export function OttoHero({
  size = 144,
  state = "idle",
  caption,
}: {
  size?: number;
  state?: OttoState;
  caption?: string;
}) {
  // snap to nearest multiple of 24 for crisp pixels
  const snapped = Math.max(24, Math.round(size / 24) * 24);
  return (
    <div
      className={`otto-hero otto-hero-${state}`}
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
      }}
      aria-label="Otto"
    >
      <OttoSprite size={snapped} state={state} />
      {caption && (
        <span
          style={{
            fontFamily: "var(--otto-font-mono)",
            fontSize: 11,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--otto-pencil)",
          }}
        >
          {caption}
        </span>
      )}
    </div>
  );
}

/**
 * Wordmark — small otter sprite next to the lowercase "otto" logotype in VT323.
 * Optional version chip (e.g. "v0.4") rendered as ink-on-cream tag.
 */
export function OttoWordmark({
  size = 22,
  withSprite = true,
  state = "idle",
  version,
}: {
  size?: number;
  withSprite?: boolean;
  state?: OttoState;
  version?: string;
}) {
  return (
    <span
      className="otto-wordmark"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        fontFamily: "var(--otto-font-display)",
        fontSize: size,
        lineHeight: 1,
        color: "var(--otto-ink)",
      }}
    >
      {withSprite && <OttoSprite size={Math.max(24, Math.round(size * 1.6 / 24) * 24)} state={state} />}
      <span style={{ letterSpacing: "0.04em" }}>otto</span>
      {version && (
        <span
          style={{
            background: "var(--otto-ink)",
            color: "var(--otto-cream)",
            fontFamily: "var(--otto-font-display)",
            fontSize: Math.round(size * 0.55),
            padding: "1px 6px 0",
            letterSpacing: "0.05em",
          }}
        >
          {version}
        </span>
      )}
    </span>
  );
}

/**
 * Magazine-style stat card — VT323 number, mono caps eyebrow.
 */
export function StatCard({
  label,
  value,
  caption,
  accent,
}: {
  label: ReactNode;
  value: ReactNode;
  caption?: string;
  accent?: boolean;
}) {
  return (
    <div className={`stat-card ${accent ? "stat-card-accent" : ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {caption && <div className="stat-caption">{caption}</div>}
    </div>
  );
}

/** Pixel glyph (10 in the set: task, diff, branch, inbox, notebook, pebble,
 *  ripple, pawprint, spinner, log). Rendered as pixelated SVG <img>. */
export type OttoGlyph =
  | "task" | "diff" | "branch" | "inbox" | "notebook"
  | "pebble" | "ripple" | "pawprint" | "spinner" | "log";

export function OttoGlyphIcon({
  name,
  size = 16,
  style,
  className,
}: {
  name: OttoGlyph;
  size?: number;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <img
      src={`/otto/glyphs/glyph-${name}.svg`}
      width={size}
      height={size}
      alt={name}
      className={`otto-glyph ${className ?? ""}`}
      style={{ imageRendering: "pixelated", verticalAlign: "middle", ...style }}
      draggable={false}
    />
  );
}

/** Integration platform glyph. Loaded as a current-color SVG so it
 *  inherits the surrounding text color (amber-dim by default in
 *  step headers). */
export type IntegrationName =
  | "zoom" | "granola" | "github" | "cursor" | "slack" | "meet";

export function IntegrationGlyph({
  name,
  size = 16,
  color,
  style,
}: {
  name: IntegrationName;
  size?: number;
  color?: string;
  style?: CSSProperties;
}) {
  // currentColor inheritance only works when the SVG is inlined as
  // <svg>, not when used as <img src>. Load via <object> so the SVG
  // can read the surrounding color, OR use a CSS mask. Easiest is
  // mask-image so we can set color via CSS background.
  return (
    <span
      className="otto-glyph"
      role="img"
      aria-label={name}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        backgroundColor: color ?? "var(--otto-amber-dim, #a87528)",
        WebkitMask: `url(/otto/integrations/${name}.svg) no-repeat center / contain`,
        mask: `url(/otto/integrations/${name}.svg) no-repeat center / contain`,
        verticalAlign: "middle",
        ...style,
      }}
    />
  );
}
