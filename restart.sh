#!/bin/bash
set -e
cd "$(dirname "$0")"

./stop.sh
./start.sh
