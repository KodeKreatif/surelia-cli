#!/bin/bash
#
#  ./learn.sh [option] [messageId] [maildirpath]
#
#  Example usage : 
#   - Learn it as ham (not spam)
#       ./learn.sh spam fd0sNZ_iJi3Nc7Ga@mail.gmail.com /path/to/user/maildir
#   - Learn it as spam
#       ./learn.sh spam Ga4GLSnq4CNEQFDw@mail.gmail.com /path/to/user/maildir
#
#

OPT=$1
MESSAGEID=$2
MAILDIR=$3
DIRS=("cur" "new" "tmp")

for DIR in "${DIRS[@]}"
  do :
    cd $MAILDIR/$DIR
    FILENAME=''
    FILENAME=$(grep -rl $MESSAGEID)
    if [ -f $MAILDIR/$DIR/$FILENAME ]
    then
      cat $FILENAME | sa-learn --$OPT
    fi
  done
