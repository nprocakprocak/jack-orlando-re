# Pre-publication checklist

This is a working checklist for the first public push. It is not legal advice. Show it to a lawyer in Poland before publication.

Do not push until every item is checked and the command in the gate at the end prints no paths. This file does not publish anything by itself.

## Game files, decompilation, quotations

- [x] The engine reads game files the user already has. The repository does not contain them.
- [x] The tree contains no decompilation and no binary-analysis project.
- [x] The tree contains no game screenshots, cover art, or logo.
- [x] Notes describe original behavior without quoting a spoken line, a script body, or a complete configuration. Menu captions, verb labels, slot labels, the three refusal captions, and the numeric tables live in the modules that use them.
- [x] Tests and documentation contain no script bodies, dialogue files, or complete game configuration files. A test of other behavior uses a short invented label.
- [x] `.gitignore` excludes game archives (`*.pak`, `*.phk`, `*.ph2`), the executable (`*.exe`), saves (`*.sav`, `*.avx`), game ZIPs, and screenshots.

## Name

- [x] The name "Jack Orlando" is used descriptively: it names which game the engine reads.
- [x] The README implies no connection with the rights holder and contains no logo or cover art.

## Read interface

- [x] The code keeps the algorithms needed to read the user's own files: the PAK archive, the BM image, the text cipher, and macros.

## Copied pieces

The engine does not read the executable. Fonts come from the user's `Resource.pak`. Menu captions, verb labels, slot labels, the three refusal captions, and the numeric tables live in the modules that use them.

- [x] New dialogue, scripts, and complete configuration files stay out of the repository. A test of other behavior compares against a short invented label.

## Gate

A push to a remote waits until the list above is checked and the command below prints no paths (files in the index, which is what would enter a commit):

```
git ls-files -- "*.pak" "*.phk" "*.ph2" "*.exe" "*.sav" "*.avx"
```
