#!/usr/bin/env bun
import {
  createCliRenderer,
  Box,
  Text,
  ScrollBox,
  Input,
} from "@opentui/core";
import { cmdInstall, cmdStatus, cmdHelp, CommandResult } from "./commands";

const HEADER_BG = "#1a1a2e";
const HEADER_FG = "#00d4aa";
const PROMPT_FG = "#00d4aa";
const OUTPUT_FG = "#e0e0e0";
const ERROR_FG = "#ff6b6b";
const SUCCESS_FG = "#51cf66";

async function main() {
  const renderer = await createCliRenderer({ exitOnCtrlC: true });

  const header = Box(
    {
      height: 3,
      backgroundColor: HEADER_BG,
      flexDirection: "row",
      alignItems: "center",
      paddingLeft: 2,
    },
    Text({ content: "  FinSentry  ", fg: HEADER_FG, bold: true }),
    Text({ content: "│  RBI Compliance Dashboard", fg: "#8899aa" }),
  );

  const outputScroll = ScrollBox(
    {
      flexGrow: 1,
      paddingLeft: 1,
      paddingRight: 1,
    },
    Text({ content: "Type /help to get started.", fg: "#667788" }),
  );

  function addOutput(content: string, fg?: string) {
    const t = Text({ content, fg: fg || OUTPUT_FG });
    outputScroll.add(t);
    outputScroll.scrollTo(outputScroll.scrollHeight);
  }

  const inputField = Input({
    placeholder: "Type a command...",
    width: "100%",
    onSubmit: (value: string) => {
      const cmd = value.trim();
      if (!cmd) return;
      addOutput(`> ${cmd}`, PROMPT_FG);

      let promise: Promise<CommandResult>;
      const lower = cmd.toLowerCase();
      if (lower === "/install") promise = cmdInstall();
      else if (lower === "/status") promise = cmdStatus();
      else if (lower === "/help") promise = cmdHelp();
      else {
        addOutput(`  Unknown command: ${cmd}`, ERROR_FG);
        addOutput(`  Type /help for available commands.`, OUTPUT_FG);
        return;
      }

      promise.then((result) => {
        for (const line of result.lines) {
          addOutput(`  ${line}`, result.success ? OUTPUT_FG : ERROR_FG);
        }
        if (!result.success) {
          addOutput(`  Command completed with errors.`, ERROR_FG);
        }
      });
    },
  });

  const inputBox = Box(
    {
      height: 3,
      flexDirection: "row",
      alignItems: "center",
      paddingLeft: 1,
    },
    Text({ content: "> ", fg: PROMPT_FG, bold: true }),
    inputField,
  );

  renderer.root.add(
    Box(
      {
        width: "100%",
        height: "100%",
        flexDirection: "column",
      },
      header,
      outputScroll,
      inputBox,
    ),
  );

  inputField.focus();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
