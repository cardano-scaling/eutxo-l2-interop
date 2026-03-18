import * as React from "react";

type DivProps = React.ComponentProps<"div">;
type TextProps = React.ComponentProps<"p">;
type CodeProps = React.ComponentProps<"code">;

export function PageGrid(props: DivProps) {
  return <div style={layoutStyles.pageGrid} {...props} />;
}

export function FieldGrid(props: DivProps) {
  return <div style={layoutStyles.fieldGrid} {...props} />;
}

export function Row(props: DivProps) {
  return <div style={layoutStyles.row} {...props} />;
}

export function ActionSplit(props: DivProps) {
  return <div style={layoutStyles.actionSplit} {...props} />;
}

export function ActionButtonsCol(props: DivProps) {
  return <div style={layoutStyles.actionButtonsCol} {...props} />;
}

export function MetaText(props: TextProps) {
  return <p style={layoutStyles.metaText} {...props} />;
}

export function HelperText(props: TextProps) {
  return <p style={layoutStyles.helperText} {...props} />;
}

export function WarnText(props: TextProps) {
  return <p style={layoutStyles.warnText} {...props} />;
}

export function MutedText(props: TextProps) {
  return <p style={layoutStyles.mutedText} {...props} />;
}

export function ConnectedBanner(props: TextProps) {
  return <p style={layoutStyles.connectedBanner} {...props} />;
}

export function IdempotencyText(props: TextProps) {
  return <p style={layoutStyles.idempotencyText} {...props} />;
}

export function InlineCodeBlock(props: CodeProps) {
  return <code style={layoutStyles.inlineCodeBlock} {...props} />;
}

export function ListWrap(props: DivProps) {
  return <div style={layoutStyles.listWrap} {...props} />;
}

export function ListSummary(props: TextProps) {
  return <p style={layoutStyles.listSummary} {...props} />;
}

export function ListUl(props: React.ComponentProps<"ul">) {
  return <ul style={layoutStyles.listUl} {...props} />;
}

export function ListItemCard(props: React.ComponentProps<"li">) {
  return <li style={layoutStyles.listItemCard} {...props} />;
}

export function LinkButton(props: React.ComponentProps<"button">) {
  return <button type="button" style={layoutStyles.linkButton} {...props} />;
}

export function SectionSubTitle(props: React.ComponentProps<"h3">) {
  return <h3 style={layoutStyles.sectionSubTitle} {...props} />;
}

export function WrapRow(props: DivProps) {
  return <div style={layoutStyles.wrapRow} {...props} />;
}

export function CardTitleLg(props: React.ComponentProps<"div">) {
  return <div style={layoutStyles.cardTitleLg} {...props} />;
}

export function CardDescriptionSm(props: React.ComponentProps<"div">) {
  return <div style={layoutStyles.cardDescriptionSm} {...props} />;
}

const layoutStyles: Record<string, React.CSSProperties> = {
  pageGrid: {
    width: "100%",
    maxWidth: "100%",
    margin: 0,
    padding: "clamp(8px, 2vw, 14px)",
    display: "grid",
    gap: 12,
  },
  fieldGrid: { display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" },
  row: { display: "flex", alignItems: "end", gap: 8 },
  actionSplit: { display: "grid", gap: 12, gridTemplateColumns: "minmax(0, 1fr) 220px" },
  actionButtonsCol: { display: "grid", gap: 8, alignContent: "start" },
  metaText: { marginTop: 0, color: "#475569", fontSize: 13 },
  helperText: { marginTop: 6, marginBottom: 0, color: "#52525b", fontSize: 12 },
  warnText: { marginTop: 8, marginBottom: 0, color: "#b45309" },
  mutedText: { marginTop: 8, marginBottom: 0, color: "#71717a" },
  connectedBanner: {
    marginTop: 8,
    marginBottom: 0,
    color: "#334155",
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    borderRadius: 10,
    padding: "6px 8px",
    fontSize: 13,
  },
  idempotencyTextTop: { marginTop: 8, marginBottom: 0, color: "#71717a", fontSize: 12 },
  idempotencyText: { marginTop: 6, marginBottom: 0, color: "#71717a", fontSize: 12 },
  inlineCodeBlock: { display: "block", overflowWrap: "anywhere", wordBreak: "break-word" },
  listWrap: { marginTop: 10 },
  listSummary: { margin: "0 0 8px 0", color: "var(--muted-foreground)", fontWeight: 600 },
  listUl: { margin: 0, paddingLeft: 18 },
  listItemCard: {
    marginBottom: 6,
    background: "var(--card)",
    color: "var(--foreground)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "4px 7px",
    listStylePosition: "inside",
  },
  linkButton: {
    border: "none",
    background: "transparent",
    color: "var(--primary)",
    cursor: "pointer",
    padding: 0,
  },
  sectionSubTitle: { marginTop: 16, marginBottom: 8 },
  wrapRow: { marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" },
  cardTitleLg: { fontSize: 24 },
  cardDescriptionSm: { marginTop: 0, color: "#475569", fontSize: 13 },
};

