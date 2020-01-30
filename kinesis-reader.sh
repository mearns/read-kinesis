#!/bin/bash

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

if [ ! -d "$DIR/node_modules" ]
then
    npm --prefix "$DIR" install
fi

npm --prefix "$DIR" --silent start -- $@
