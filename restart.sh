#!/bin/bash
pkill gunicorn
sleep 2
cd /www/wwwroot/guzhi/
gunicorn -c gunicorn.conf.py fund_api:app -D
