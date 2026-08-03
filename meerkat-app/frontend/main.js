const term = new Terminal({
  fontFamily: "Menlo, Consolas, monospace",
  fontSize: 14,
  theme: { background: "#1e1e1e" },
  cursorBlink: true,
});
term.open(document.getElementById("terminal"));
term.writeln("Meerkat — connecting...");

let cwd = "~";
let currentLine = "";
let bannerSeen = false;

function prompt() {
  term.write(`\r\n\x1b[36mmeerkat\x1b[0m \x1b[33m${cwd}\x1b[0m> `);
}

// Every raw daemon protocol line arrives here. This is the one place
// that knows about "O:"/"E:"/"D:"/"X:" — if the protocol grows (job
// control events, etc.) this is where new prefixes get handled.
window.runtime.EventsOn("daemon:line", (raw) => {
  if (raw.startsWith("O:")) {
    term.write("\r\n" + raw.slice(2));
  } else if (raw.startsWith("E:")) {
    term.write(`\r\n\x1b[31m${raw.slice(2)}\x1b[0m`);
  } else if (raw.startsWith("D:")) {
    cwd = raw.slice(2);
    if (!bannerSeen) {
      bannerSeen = true;
      prompt();
    }
  } else if (raw.startsWith("X:")) {
    prompt();
  }
});

window.runtime.EventsOn("daemon:error", (msg) => {
  term.writeln(`\r\n\x1b[31mConnection error: ${msg}\x1b[0m`);
});

window.runtime.EventsOn("daemon:closed", () => {
  term.writeln("\r\n\x1b[90m[daemon connection closed]\x1b[0m");
});

// The daemon has no pty, so there's no kernel tty driver doing local
// echo or backspace for us — we fake "cooked mode" here: echo each
// keystroke into the terminal ourselves, buffer the line, and only
// hand it to Go on Enter. This is a deliberate simplification, not a
// missing feature — see meerkat-daemon's README for the pty/erlexec
// phase that would let real curses programs (vim, htop, less) work,
// at which point raw bytes could be forwarded on every keystroke
// instead.
term.onData((data) => {
  const code = data.charCodeAt(0);

  if (data === "\r") {
    window.go.main.App.SendLine(currentLine);
    currentLine = "";
  } else if (code === 127) {
    if (currentLine.length > 0) {
      currentLine = currentLine.slice(0, -1);
      term.write("\b \b");
    }
  } else if (code < 32) {
    // Ctrl+C / Ctrl+D / etc. — real handling arrives with job control.
  } else {
    currentLine += data;
    term.write(data);
  }
});
