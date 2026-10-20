#!/bin/bash
cd /www/wwwroot/guzhi/
gunicorn -c gunicorn.conf.py fund_api:app -D
