import React from "react";
import { Box, Text, useStdout } from "ink";
import { pilotDeckDarkBlueTheme } from "./theme.js";

const ANSI_SHADOW_LOGO = [
  " ██████╗ ██████╗  ██████╗    ██████╗ ██████╗  █████╗ ██╗███╗   ██╗",
  "██╔═══██╗██╔══██╗██╔════╝    ██╔══██╗██╔══██╗██╔══██╗██║████╗  ██║",
  "██║   ██║██████╔╝██║         ██████╔╝██████╔╝███████║██║██╔██╗ ██║",
  "██║   ██║██╔═══╝ ██║         ██╔══██╗██╔══██╗██╔══██║██║██║╚██╗██║",
  "╚██████╔╝██║     ╚██████╗    ██████╔╝██║  ██║██║  ██║██║██║ ╚████║",
  " ╚═════╝ ╚═╝      ╚═════╝    ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝",
];

// "OPC" occupies the first block; "Brain" occupies the second.
const ANSI_SHADOW_PILOT_WIDTH = 29;
const ANSI_SHADOW_VISIBLE_COLS = 68;
// border (2) + paddingX (4) + marginX (2) on the WelcomeCard wrapper.
const ANSI_SHADOW_MIN_TERMINAL_COLS = ANSI_SHADOW_VISIBLE_COLS + 8;

const STANDARD_LOGO = [
  "   ___  ____   ____   ____            _       ",
  "  / _ \\|  _ \\ / ___| | __ ) _ __ __ _(_)_ __  ",
  " | | | | |_) | |     |  _ \\| '__/ _` | | '_ \\ ",
  " | |_| |  __/| |___  | |_) | | | (_| | | | | |",
  "  \\___/|_|    \\____| |____/|_|  \\__,_|_|_| |_|",
];

export function PilotDeckLogo({ tagline }: { tagline?: string } = {}): React.ReactNode {
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;
  const useShadow = cols >= ANSI_SHADOW_MIN_TERMINAL_COLS;

  return (
    <Box flexDirection="column">
      {useShadow
        ? ANSI_SHADOW_LOGO.map((line, index) => {
            const pilot = line.slice(0, ANSI_SHADOW_PILOT_WIDTH);
            const deck = line.slice(ANSI_SHADOW_PILOT_WIDTH);
            return (
              <Text key={index}>
                <Text color={pilotDeckDarkBlueTheme.brand} bold>
                  {pilot}
                </Text>
                <Text color={pilotDeckDarkBlueTheme.brandAccent} bold>
                  {deck}
                </Text>
              </Text>
            );
          })
        : STANDARD_LOGO.map((line, index) => (
            <Text key={index} color={pilotDeckDarkBlueTheme.brandAccent} bold>
              {line}
            </Text>
          ))}
      {tagline ? (
        <Box marginTop={1}>
          <Text color={pilotDeckDarkBlueTheme.brandAccent} bold>
            {"↗  "}
          </Text>
          <Text color={pilotDeckDarkBlueTheme.subtle}>{tagline}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

export function CondensedLogo(): React.ReactNode {
  return (
    <Text>
      <Text color={pilotDeckDarkBlueTheme.brand} bold>
        OPC
      </Text>
      <Text color={pilotDeckDarkBlueTheme.brandAccent} bold>
        Brain
      </Text>
      <Text color={pilotDeckDarkBlueTheme.brandAccent}> ↗</Text>
    </Text>
  );
}
