# -*- coding: utf-8 -*-
import json, io
d = json.load(io.open('data/province_shapes.json', encoding='utf-8'))
for pid in ['jingzhi', 'liaodong', 'guangdong', 'yunnan']:
    print(pid, d['provinces'][pid]['label'], len(d['provinces'][pid]['polys']))
print('neighbors:', [n['text'] for n in d['decor']['neighbors']])
