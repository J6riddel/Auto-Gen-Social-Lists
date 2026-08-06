/**
 * Card renderer. Satori (JSX -> SVG) then resvg (SVG -> PNG). No browser, no
 * headless Chromium in CI, ~200ms.
 *
 * Satori supports a flexbox subset only — no grid, no float, every element
 * needs an explicit display. For a ranked list that is plenty.
 *
 * This is programmatic rendering, not image generation. The numbers on the card
 * are the numbers the API returned, which is the point.
 */

import { readFile } from "node:fs/promises";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { tokens as t } from "./tokens.js";
import type { RankedList } from "../types.js";

function formatValue(value: number, metric: string): string {
  if (metric === "emv") {
    return `$${Math.round(value).toLocaleString("en-US")}`;
  }
  return Math.round(value).toLocaleString("en-US");
}

function footerLine(list: RankedList): string {
  const { spec, rows } = list;
  const range = spec.dateRange
    ? `${spec.dateRange.start} to ${spec.dateRange.end}`
    : `as of ${list.queriedAt.slice(0, 10)}`;
  return `socialpruf · ${spec.platform} · ${range} · n=${rows.length}`;
}

function Card({ list }: { list: RankedList }) {
  const { spec, rows } = list;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: t.size.w,
        height: t.size.h,
        backgroundColor: t.color.bg,
        padding: t.space.pad,
        fontFamily: t.font.display,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", marginBottom: 44 }}>
        <div
          style={{
            fontSize: t.type.title,
            color: t.color.text,
            fontWeight: 700,
            lineHeight: 1.1,
          }}
        >
          {spec.title}
        </div>
        {spec.caveat ? (
          <div style={{ fontSize: t.type.subtitle, color: t.color.dim, marginTop: 14 }}>
            {spec.caveat}
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
        {rows.map((r, i) => (
          <div
            key={r.entityId}
            style={{
              display: "flex",
              alignItems: "center",
              height: t.space.rowH,
              marginBottom: t.space.rowGap,
              paddingLeft: 20,
              paddingRight: 20,
              backgroundColor: i === 0 ? t.color.surface : "transparent",
              borderBottom: `1px solid ${t.color.rule}`,
            }}
          >
            <div
              style={{
                display: "flex",
                width: 64,
                fontSize: t.type.rank,
                fontFamily: t.font.mono,
                color: i === 0 ? t.color.accent : t.color.dim,
              }}
            >
              {String(i + 1).padStart(2, "0")}
            </div>
            <div
              style={{
                display: "flex",
                flexGrow: 1,
                fontSize: t.type.name,
                color: t.color.text,
                fontWeight: i === 0 ? 700 : 400,
              }}
            >
              {r.name}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: t.type.value,
                fontFamily: t.font.mono,
                color: i === 0 ? t.color.accent : t.color.text,
              }}
            >
              {formatValue(r.value, spec.metric)}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          fontSize: t.type.footer,
          fontFamily: t.font.mono,
          color: t.color.dim,
          marginTop: 32,
        }}
      >
        {footerLine(list)}
      </div>
    </div>
  );
}

async function loadFonts() {
  // Drop the .ttf files into fonts/ — see fonts/README.md.
  return [
    {
      name: t.font.display,
      data: await readFile("fonts/Inter-Regular.ttf"),
      weight: 400 as const,
      style: "normal" as const,
    },
    {
      name: t.font.display,
      data: await readFile("fonts/Inter-Bold.ttf"),
      weight: 700 as const,
      style: "normal" as const,
    },
    {
      name: t.font.mono,
      data: await readFile("fonts/JetBrainsMono-Regular.ttf"),
      weight: 400 as const,
      style: "normal" as const,
    },
  ];
}

export async function renderCard(list: RankedList): Promise<{ svg: string; png: Buffer }> {
  const svg = await satori(<Card list={list} />, {
    width: t.size.w,
    height: t.size.h,
    fonts: await loadFonts(),
  });

  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: t.size.w },
  })
    .render()
    .asPng();

  return { svg, png };
}
