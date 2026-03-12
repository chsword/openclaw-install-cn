'use strict';

/**
 * `oclaw completion` command.
 * Generates shell completion scripts for bash, zsh, and fish.
 */

/** All known subcommands and their options, used to build completion scripts. */
const SUBCOMMANDS = [
  {
    name: 'install',
    description: 'Install or reinstall OpenClaw via pnpm',
    options: [
      { flag: '--force', description: 'reinstall even if already at the latest version', hasArg: false },
    ],
  },
  {
    name: 'upgrade',
    description: 'Check for updates and upgrade OpenClaw if a newer version is available',
    options: [
      { flag: '--check', description: 'only check for updates, do not upgrade', hasArg: false },
    ],
  },
  {
    name: 'status',
    description: 'Show current installation status and version',
    options: [
      { flag: '--check-updates', description: 'also check manifest.json for the latest available version', hasArg: false },
    ],
  },
  {
    name: 'config',
    description: 'View oclaw configuration',
    options: [
      { flag: '--reset', description: 'reset configuration to defaults', hasArg: false },
      { flag: '--list', description: 'list current configuration (default action)', hasArg: false },
    ],
  },
  {
    name: 'version',
    description: 'Display the oclaw CLI version',
    options: [],
  },
  {
    name: 'completion',
    description: 'Generate shell completion scripts',
    options: [
      { flag: '--shell', description: 'shell type: bash, zsh, or fish (default: bash)', hasArg: true },
    ],
  },
];

/**
 * Generate a bash completion script for oclaw.
 * @returns {string}
 */
function generateBash() {
  const commandNames = SUBCOMMANDS.map((c) => c.name).join(' ');

  const cases = SUBCOMMANDS.map((cmd) => {
    const flags = cmd.options.map((o) => o.flag).join(' ');
    return `    ${cmd.name})\n      COMPREPLY=($(compgen -W "${flags}" -- "$cur"))\n      ;;`;
  }).join('\n');

  return `# bash completion for oclaw
# Source this file or place it in your bash_completion.d directory:
#   Linux : sudo cp /dev/stdin /etc/bash_completion.d/oclaw <<'EOF'
#   macOS : sudo cp /dev/stdin /usr/local/etc/bash_completion.d/oclaw <<'EOF'

_oclaw() {
  local cur prev words cword
  _init_completion 2>/dev/null || {
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"
    words=("\${COMP_WORDS[@]}")
    cword=$COMP_CWORD
  }

  local commands="${commandNames}"

  if [[ $cword -eq 1 ]]; then
    COMPREPLY=($(compgen -W "$commands" -- "$cur"))
    return
  fi

  case "\${words[1]}" in
${cases}
  esac
}

complete -F _oclaw oclaw
`;
}

/**
 * Generate a zsh completion script for oclaw.
 * @returns {string}
 */
function generateZsh() {
  const commandDescriptions = SUBCOMMANDS.map(
    (c) => `        '${c.name}:${c.description}'`
  ).join('\n');

  const cases = SUBCOMMANDS.map((cmd) => {
    if (cmd.options.length === 0) return `        ${cmd.name}) ;;`;
    const args = cmd.options
      .map((o) => {
        if (o.hasArg) {
          return `            '${o.flag}[${o.description}]:value'`;
        }
        return `            '${o.flag}[${o.description}]'`;
      })
      .join(' \\\n');
    return `        ${cmd.name})\n          _arguments \\\n${args}\n          ;;`;
  }).join('\n');

  return `#compdef oclaw
# zsh completion for oclaw
# Place this file in a directory on your $fpath:
#   mkdir -p ~/.zsh/completions && oclaw completion --shell zsh > ~/.zsh/completions/_oclaw
# Then add to ~/.zshrc:  fpath=(~/.zsh/completions $fpath)  and run:  autoload -Uz compinit && compinit

_oclaw() {
  local state

  _arguments \\
    '1: :->command' \\
    '*: :->args'

  case $state in
    command)
      local -a commands
      commands=(
${commandDescriptions}
      )
      _describe 'command' commands
      ;;
    args)
      case $words[2] in
${cases}
      esac
      ;;
  esac
}

_oclaw
`;
}

/**
 * Generate a fish completion script for oclaw.
 * @returns {string}
 */
function generateFish() {
  const commandNames = SUBCOMMANDS.map((c) => c.name).join(' ');

  const subcommandLines = SUBCOMMANDS.map(
    (c) =>
      `complete -c oclaw -f -n "not __fish_seen_subcommand_from ${commandNames}" -a ${c.name} -d '${c.description}'`
  ).join('\n');

  const optionLines = SUBCOMMANDS.filter((c) => c.options.length > 0)
    .map((cmd) => {
      const lines = cmd.options.map((o) => {
        const flag = o.flag.replace(/^--/, '');
        const argPart = o.hasArg ? ' -r' : '';
        return `complete -c oclaw -f -n "__fish_seen_subcommand_from ${cmd.name}"${argPart} -l ${flag} -d '${o.description}'`;
      });
      return `# ${cmd.name} options\n${lines.join('\n')}`;
    })
    .join('\n\n');

  return `# fish completion for oclaw
# Place this file in your fish completions directory:
#   oclaw completion --shell fish > ~/.config/fish/completions/oclaw.fish

# Subcommands
${subcommandLines}

${optionLines}
`;
}

/**
 * Run the completion command.
 * @param {Object} options
 * @param {string} [options.shell] - target shell (bash, zsh, fish); defaults to bash
 */
function runCompletion(options = {}) {
  const shell = (options.shell || 'bash').toLowerCase();

  switch (shell) {
    case 'bash':
      process.stdout.write(generateBash());
      break;
    case 'zsh':
      process.stdout.write(generateZsh());
      break;
    case 'fish':
      process.stdout.write(generateFish());
      break;
    default:
      console.error(`\x1b[31m✖  Unsupported shell: "${shell}". Supported shells: bash, zsh, fish\x1b[0m`);
      process.exit(1);
  }
}

module.exports = { runCompletion, generateBash, generateZsh, generateFish, SUBCOMMANDS };
