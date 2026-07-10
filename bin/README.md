# Project Scripts

This directory contains executable scripts for convenient command-line access.

## Available Commands

- `fixerrors` - Run the automated error analysis and fixing script

## Setup for Direct Command Access

### Option 1: Add to PATH (Recommended)

Add this to your `~/.bashrc` or `~/.bash_profile`:

```bash
export PATH="$PATH:<repo-path>/bin"
```

Then reload your shell:
```bash
source ~/.bashrc
```

Now you can type `fixerrors` from anywhere!

### Option 2: Create an Alias

Add this to your `~/.bashrc` or `~/.bash_profile`:

```bash
alias fixerrors='<repo-path>/bin/fixerrors'
```

Then reload:
```bash
source ~/.bashrc
```

### Option 3: Run from Project Root

When inside the project directory:
```bash
./bin/fixerrors
```

---

## For CMD/PowerShell Users

Use the `.bat` version:
```cmd
bin\fixerrors.bat
```

Or add `D:\Websites\ffts\bin` to your Windows PATH environment variable.
