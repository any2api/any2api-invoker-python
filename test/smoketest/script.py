import os
import sys

print 'ARGS:', str(sys.argv)

print 'STDIN:'
for line in sys.stdin:
  print line,

print 'ENV:'
print 'FOO =', os.environ['FOO']

print 'FILE:'
with open('./input.txt', 'r') as f:
  print f.read()

with open('./output.txt', 'w') as f:
  f.write('some output written by script.py\nline break\n')
