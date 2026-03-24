#!/usr/bin/env python3
"""資料庫初始化腳本"""
import sys
import os

# 加入專案根目錄到 path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import init_db

if __name__ == "__main__":
    print("初始化資料庫...")
    init_db()
    print("完成！")
