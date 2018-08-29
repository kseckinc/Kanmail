import _ from 'lodash';
import hash from 'object-hash';

import requestStore from 'stores/request.js';
import { BaseStore } from 'stores/base.jsx';

import { addMessage, deleteMessage } from 'util/messages.js';


function makeDefaults() {
    return {
        messages: null,
        containerWidth: null,
        containerLeft: null,
        fetching: false,
    };
}


function calculateContainerWidth(columnContainer) {
    const columnWidth = columnContainer.offsetWidth;
    const columnLeft = columnContainer.offsetLeft + 150;
    const windowWidth = window.outerWidth;

    // Max width is 3x column (also ideal width)
    const maxWidth = 3 * columnWidth;

    let containerWidth;
    let containerLeft;

    const spaceLeft = columnLeft;
    const spaceRight = windowWidth - (columnLeft + columnWidth);

    if (spaceRight > spaceLeft) {
        containerLeft = columnLeft + columnWidth;
        containerWidth = Math.min(maxWidth, spaceRight);
    } else {
        containerWidth = Math.min(maxWidth, spaceLeft);
        containerLeft = 150;

        if (spaceLeft < maxWidth) {
            containerLeft = 0;
        }
    }

    return [containerWidth, containerLeft];
}


function makeFolderUidParts(thread) {
    return _.reduce(
        thread,
        (memo, message) => {
            const folderName = _.keys(message.folderUids)[0];
            const uid = message.folderUids[folderName];

            if (!memo[folderName]) {
                memo[folderName] = [];
            }

            memo[folderName].push({
                uid,
                message,
            });

            return memo;
        },
        {},
    )
}


class ThreadStore extends BaseStore {
    /*
        Global store of the current open thread (overlay).
    */

    static storeKey = 'threadStore';

    constructor() {
        super();

        this.isOpen = false;
        this.props = makeDefaults();
    }

    open(columnContainer, thread, onClose) {
        if (this.isOpen) {
            this.close();
        }

        // Build a list of (UID, folder, part#) for each message in the thread
        const folderUidParts = makeFolderUidParts(thread);
        // Make a hash to use as the critical request nonce
        const criticalRequestNonce = hash(folderUidParts);

        // Calculate the width/left styles of the column
        [
            this.props.containerWidth,
            this.props.containerLeft,
        ] = calculateContainerWidth(columnContainer);

        // Set to empty thread (loading icon)
        this.props.messages = [];
        this.triggerUpdate();

        // Set any onClose handler
        this.onClose = onClose;

        // Fetch those emails!
        this.props.fetching = true;

        const requests = [];
        const emailBodyParts = {};
        const emailContentIds = {};

        _.each(folderUidParts, (uidParts, folderName) => {
            const accountName = uidParts[0].message.account_name;
            const uidList = [];

            // Create our ?uid=UID/PART&uid=... query args
            _.each(uidParts, message => (
                uidList.push(`${message.uid}`)
            ));

            const message = addMessage(`Fetching ${uidList.length} messages from ${folderName}...`);

            // Make the request
            const request = requestStore.get(
                `/api/emails/${accountName}/${folderName}/text`,
                {uid: uidList},
                criticalRequestNonce,
            ).then(data => {
                _.each(data.emails, (email, uid) => {
                    emailBodyParts[uid] = email.html;
                    emailContentIds[uid] = email.cid_to_part;
                });

                deleteMessage(message);
            }).catch((e) => {
                deleteMessage(message);
                throw e; // re-raise
            });

            requests.push(request);
        });

        // Once all loaded, assign all the emails and trigger the update
        Promise.all(requests).then(() => {
            if (!this.props.fetching) {
                console.debug('Ignoring returned emails, already closed!');
                return;
            }

            const messagesWithBody = _.map(thread, message => {
                const folderName = _.keys(message.folderUids)[0];
                const uid = message.folderUids[folderName];

                return {
                    body: emailBodyParts[uid],
                    contentIds: emailContentIds[uid],
                    ...message,
                };
            });

            // Sort in date-ascending order (only the last email is visible by default)
            this.props.messages = _.orderBy(messagesWithBody, message => {
                const date = new Date(message.date);
                return date;
            }, 'asc');

            this.triggerUpdate();
        });

        // Flag the current column as open and assign so we can remove on close
        columnContainer.classList.add('open');
        this.columnContainer = columnContainer;

        this.isOpen = true;
    }

    close() {
        if (!this.isOpen) {
            return;
        }

        this.props = makeDefaults();
        this.triggerUpdate();

        if (this.columnContainer) {
            this.columnContainer.classList.remove('open');
        }

        if (this.onClose) {
            this.onClose();
        }

        this.isOpen = false;
    }

    onResize = () => {
        if (!this.isOpen) {
            return;
        }

        // Calculate the width/left styles of the column
        [
            this.props.containerWidth,
            this.props.containerLeft,
        ] = calculateContainerWidth(this.columnContainer);

        this.triggerUpdate();
    }
}


const threadStore = new ThreadStore();

// Make sure that we re-calculate the thread container on window resize
window.addEventListener('resize', threadStore.onResize);

export default threadStore;