#!/bin/bash
set -e

URL=http://185.197.251.176:3000/srvly-agent
BIN=/usr/local/bin/srvly-agent

TOK=""
SRV=""
M=0
for X in "$@"; do
  if [ $M = 0 ] && [ "$X" = --token ]; then
    M=1
  elif [ $M = 0 ] && [ "$X" = --server ]; then
    M=2
  elif [ $M = 1 ]; then
    TOK="$X"
    M=0
  elif [ $M = 2 ]; then
    SRV="$X"
    M=0
  fi
done

if [ -z "$TOK" ]; then
  echo Error: --token required
  exit 1
fi
if [ -z "$SRV" ]; then
  SRV=ws://185.197.251.176:8080/ws
fi

echo Downloading agent...
curl -sL "$URL" -o /tmp/srvly-agent
chmod +x /tmp/srvly-agent
mv /tmp/srvly-agent "$BIN"
echo Installed to $BIN
$BIN --token "$TOK" --server "$SRV"