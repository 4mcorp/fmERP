#!/bin/sh
# 현재 실행기 템플릿 + -w 코드 소스. Python 표준 라이브러리만 필요하다.
exec python3 "$(dirname "$0")/run_tests.py" "$@"
