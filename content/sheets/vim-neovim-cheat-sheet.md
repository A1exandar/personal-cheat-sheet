+++
title = "Vim & Neovim Cheat Sheet"
date = 2026-09-27
description = "Core Vim modal editing commands that work identically in Vim and Neovim, plus what actually differs between the two - config files, LSP support and the plugin ecosystem."
tags = ["linux", "vim", "neovim", "editors", "sysadmin"]
+++

Vim and Neovim share the same modal editing model and almost all of the same keybindings - everything in this sheet works in both unless a section says otherwise. Neovim is a fork of Vim focused on modern tooling (built-in LSP, Lua scripting, async plugins) while staying keybinding-compatible.

## Modes

Vim is modal - the same key does different things depending on which mode you're in. This trips up more people than any other single Vim concept.

```text
Normal mode   - the default; keys are commands, not text (navigation, delete, copy, etc.)
Insert mode   - typing inserts text, like a normal editor
Visual mode   - select text, then act on the selection
Command mode  - type a : command and press Enter
```

```vim
i        " enter Insert mode before the cursor
a        " enter Insert mode after the cursor
Esc      " return to Normal mode from any other mode - the single most-used key in Vim
v        " enter Visual mode (character-wise selection)
V        " enter Visual mode (line-wise selection)
:        " enter Command mode
```

## Opening, saving, quitting

```bash
vim file.txt        # open a file (or: nvim file.txt)
vim +42 file.txt      # open and jump straight to line 42
```

```vim
:w              " write (save) the file
:w newname.txt   " save as a different filename
:q               " quit - fails if there are unsaved changes
:q!              " quit and discard unsaved changes
:wq              " write, then quit
:x               " write only if changed, then quit (slightly smarter than :wq)
```

## Basic movement (Normal mode)

```vim
h j k l    " left, down, up, right - the original arrow keys, still work today
w          " jump forward to the start of the next word
b          " jump backward to the start of the previous word
0          " jump to the start of the line
$          " jump to the end of the line
gg         " jump to the first line of the file
G          " jump to the last line of the file
42G        " jump to line 42 directly
```

## Editing

```vim
x          " delete the character under the cursor
dd         " delete (cut) the current line
dw         " delete from the cursor to the start of the next word
yy         " yank (copy) the current line
p          " paste after the cursor / current line
u          " undo
Ctrl-r     " redo
.          " repeat the last change - extremely useful for repetitive edits
```

## Working with counts

```vim
3dd    " delete 3 lines
5j      " move down 5 lines
2yy     " yank 2 lines
```

Almost any command accepts a number prefix that repeats it - this composability is a lot of Vim's actual power, more than any individual keybinding.

## Search and replace

```vim
/pattern         " search forward for "pattern"
?pattern         " search backward for "pattern"
n                " jump to the next match
N                " jump to the previous match
```

```vim
:%s/old/new/g          " replace every "old" with "new" on every line
:%s/old/new/gc         " same, but confirm (y/n) each replacement
:s/old/new/            " replace only the first match on the current line
:5,10s/old/new/g       " replace only within line range 5-10
```

## Visual mode operations

```vim
v            " start character-wise visual selection
V            " start line-wise visual selection
Ctrl-v       " start block (column) visual selection - select a rectangle across lines
```

```vim
" after selecting text with v/V:
d        " delete the selection
y        " yank (copy) the selection
>        " indent the selection
<        " un-indent the selection
```

## Multiple files and windows

```vim
:e other-file.txt    " open another file (in the same window)
:sp file.txt          " split horizontally, open file.txt in the new pane
:vsp file.txt          " split vertically
Ctrl-w w               " cycle focus between open windows/splits
Ctrl-w q               " close the current window/split
```

```vim
:bnext     " switch to the next open buffer
:bprev     " switch to the previous open buffer
:ls        " list all open buffers
```

## The config file

```bash
~/.vimrc               # Vim's config file - Vimscript syntax
~/.config/nvim/init.vim   # Neovim, if kept as Vimscript for compatibility
~/.config/nvim/init.lua   # Neovim's native config format - Lua, not Vimscript
```

```vim
" a few common .vimrc / init.vim basics
set number              " show line numbers
set relativenumber      " line numbers relative to the cursor - handy with count-prefixed commands
set expandtab           " insert spaces when Tab is pressed
set tabstop=4            " a tab character displays as 4 spaces wide
set shiftwidth=4         " indent operations (>>, <<) use 4 spaces
set ignorecase           " case-insensitive search by default
```

## Vim vs Neovim - what's actually different

| | Vim | Neovim |
|---|---|---|
| Config language | Vimscript | Lua (Vimscript still supported) |
| Language server (LSP) support | Via plugins only (`coc.nvim`, `vim-lsp`) | Built in (`:help lsp`), no plugin required |
| Async plugin execution | Limited, added later, less consistent | Native async job control from the start |
| Terminal emulator | Plugin-based | Built in (`:terminal`) |
| Plugin ecosystem | Larger, older, broader compatibility | Smaller but modern; most popular plugins support both |
| Scripting API | Vimscript, some Python/Lua via if-branches | First-class Lua API (`vim.api`, `vim.lsp`, etc.) |

> Neither is objectively "better" - Vim is the safer default on a server you don't control (it's preinstalled almost everywhere, or a one-line install away), while Neovim is the better choice for building out a full IDE-like personal setup with LSP and modern plugins. Every keybinding on this page works the same in both.

## Checking which one you're using, and switching

```bash
vim --version      # check if this is Vim, and which features it was built with
nvim --version      # check Neovim's version and build info
alias vim=nvim       # make `vim` launch Neovim instead - add to ~/.bashrc if you want this permanent
```

## Getting help without leaving the editor

```vim
:help              " open the main help index
:help dd            " help for a specific command
:help 'number'      " help for a specific option (note the quotes around option names)
:helpgrep pattern    " search all help files for a pattern
```

## Common recipes

```vim
" Remove all trailing whitespace from every line in the file
:%s/\s\+$//

" Convert all tabs in the file to spaces (after setting expandtab/tabstop)
:retab

" Jump to a line number, then delete from there to the end of the file
:42
dG
```

```bash
# Edit a file, jump to the first search match immediately on open
vim +/pattern file.txt
```

## Safety notes

- `:q!` and `dd`/`x` are permanent within the session but undoable with `u` until you close the file - once closed, undo history is gone (unless persistent undo is configured with `set undofile`).
- On a remote server you don't control, assume only plain Vim is available (often not even Neovim) - don't build muscle memory around Neovim-only features (like `:terminal` or Lua config) for anything you might need to do over a bare SSH session elsewhere.
- `:%s/old/new/g` with no confirmation can silently change more than intended if the pattern is too broad - add `c` (`:%s/old/new/gc`) whenever you're not fully sure of the match scope.
