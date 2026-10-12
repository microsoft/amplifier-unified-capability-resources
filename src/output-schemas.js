// Main 0.20.108 output contracts; resource transport uses scoped AHP URIs.
export const outputSchemas={
  "outputs.list": {
    "description": "List exact saved output relationships without opening or sending anything.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "sessionId": {
          "type": "string",
          "maxLength": 200
        },
        "includeUnlinked": {
          "type": "boolean"
        },
        "offset": {
          "type": "integer",
          "minimum": 0
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 50
        }
      },
      "required": [
        "sessionId"
      ],
      "additionalProperties": false
    }
  },
  "outputs.read": {
    "description": "Read bounded immutable content, provenance, lineage and local review comments. External links are references only unless version evidence is supplied.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "sessionId": {
          "type": "string",
          "maxLength": 200
        },
        "id": {
          "type": "string",
          "maxLength": 100
        },
        "offset": {
          "type": "integer",
          "minimum": 0
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 4000
        },
        "commentOffset": {
          "type": "integer",
          "minimum": 0
        },
        "commentLimit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 10
        }
      },
      "required": [
        "sessionId",
        "id"
      ],
      "additionalProperties": false
    }
  },
  "outputs.image": {
    "description": "Inspect an exact saved RGB/RGBA PNG snapshot up to8MB and4096px per side. A direct app_control inspection requests typed pixels at the next supported model boundary; clients read its scoped resource. The receipt alone is not visual evidence. Does not read changing source files or start work.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "sessionId": {
          "type": "string",
          "maxLength": 200
        },
        "id": {
          "type": "string",
          "maxLength": 100
        },
        "sha256": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        }
      },
      "required": [
        "sessionId",
        "id",
        "sha256"
      ],
      "additionalProperties": false
    }
  },
  "outputs.images": {
    "description": "Inspect two saved PNGs together, in the supplied order, for visual comparison. Choose distinct images with exact id and sha256, up to8MB combined and4096px per side. Read both returned scoped resources to view their pixels. Both images must be available; the receipt alone is not pixels. Does not generate or start work.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "sessionId": {
          "type": "string",
          "maxLength": 200
        },
        "images": {
          "type": "array",
          "minItems": 2,
          "maxItems": 2,
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string",
                "maxLength": 100
              },
              "sha256": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              }
            },
            "required": [
              "id",
              "sha256"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "sessionId",
        "images"
      ],
      "additionalProperties": false
    }
  },
  "outputs.attach": {
    "description": "Attach a file/dataset snapshot, exact saved canvas body, PR or external document reference. Does not publish, fetch remote contents or change selection. File snapshots stay within this conversation workspace.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "sessionId": {
          "type": "string",
          "maxLength": 200
        },
        "messageId": {
          "type": "string",
          "maxLength": 200
        },
        "parentId": {
          "type": "string",
          "maxLength": 100
        },
        "evidenceIds": {
          "type": "array",
          "maxItems": 20,
          "items": {
            "type": "string",
            "maxLength": 100
          }
        },
        "kind": {
          "enum": [
            "file",
            "dataset",
            "canvas",
            "pull_request",
            "external_document"
          ]
        },
        "title": {
          "type": "string",
          "maxLength": 200
        },
        "path": {
          "type": "string",
          "maxLength": 4000
        },
        "url": {
          "type": "string",
          "maxLength": 4000
        },
        "canvasId": {
          "type": "string",
          "maxLength": 100
        },
        "version": {
          "type": "string",
          "maxLength": 500
        },
        "expectedSha256": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        }
      },
      "required": [
        "sessionId",
        "kind",
        "title"
      ],
      "additionalProperties": false
    }
  },
  "outputs.write": {
    "description": "Save a reusable writing output or an immutable next version. Does not send, publish or overwrite any original.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "sessionId": {
          "type": "string",
          "maxLength": 200
        },
        "messageId": {
          "type": "string",
          "maxLength": 200
        },
        "parentId": {
          "type": "string",
          "maxLength": 100
        },
        "evidenceIds": {
          "type": "array",
          "maxItems": 20,
          "items": {
            "type": "string",
            "maxLength": 100
          }
        },
        "content": {
          "type": "string",
          "maxLength": 100000
        },
        "variant": {
          "enum": [
            "standard",
            "document",
            "email",
            "chat_message",
            "social_post"
          ]
        },
        "subject": {
          "type": "string",
          "maxLength": 500
        },
        "title": {
          "type": "string",
          "maxLength": 200
        }
      },
      "required": [
        "sessionId",
        "title",
        "content",
        "variant"
      ],
      "additionalProperties": false
    }
  },
  "outputs.review": {
    "description": "Snapshot a bounded read-only local Git diff for review. No changes applied; untracked and binary content excluded. Branch mode resolves existing base and HEAD commits.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "sessionId": {
          "type": "string",
          "maxLength": 200
        },
        "messageId": {
          "type": "string",
          "maxLength": 200
        },
        "parentId": {
          "type": "string",
          "maxLength": 100
        },
        "evidenceIds": {
          "type": "array",
          "maxItems": 20,
          "items": {
            "type": "string",
            "maxLength": 100
          }
        },
        "mode": {
          "enum": [
            "unstaged",
            "staged",
            "branch"
          ]
        },
        "base": {
          "type": "string",
          "maxLength": 200
        },
        "path": {
          "type": "string",
          "maxLength": 4000
        },
        "title": {
          "type": "string",
          "maxLength": 200
        }
      },
      "required": [
        "sessionId",
        "mode"
      ],
      "additionalProperties": false
    }
  },
  "outputs.unlink": {
    "description": "Unlink an output from the active list. The underlying object, snapshot and comments are retained.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "sessionId": {
          "type": "string",
          "maxLength": 200
        },
        "id": {
          "type": "string",
          "maxLength": 100
        },
        "expectedRevision": {
          "type": "integer",
          "minimum": 1
        }
      },
      "required": [
        "sessionId",
        "id",
        "expectedRevision"
      ],
      "additionalProperties": false
    }
  },
  "outputs.relink": {
    "description": "Restore a previously unlinked output relationship.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "sessionId": {
          "type": "string",
          "maxLength": 200
        },
        "id": {
          "type": "string",
          "maxLength": 100
        },
        "expectedRevision": {
          "type": "integer",
          "minimum": 1
        }
      },
      "required": [
        "sessionId",
        "id",
        "expectedRevision"
      ],
      "additionalProperties": false
    }
  },
  "outputs.comment": {
    "description": "Save a local review comment on an exact saved version. It is not posted to a remote PR. Diff locations must match a displayed saved hunk.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "sessionId": {
          "type": "string",
          "maxLength": 200
        },
        "id": {
          "type": "string",
          "maxLength": 100
        },
        "body": {
          "type": "string",
          "maxLength": 8000,
          "minLength": 1
        },
        "path": {
          "type": "string",
          "maxLength": 4000
        },
        "side": {
          "enum": [
            "left",
            "right"
          ]
        },
        "line": {
          "type": "integer",
          "minimum": 1
        }
      },
      "required": [
        "sessionId",
        "id",
        "body"
      ],
      "additionalProperties": false
    }
  }
};

outputSchemas['outputs.attachImage']={
 description:'Save an exact generated PNG from a completed image receipt in this workspace. Verifies local bytes and SHA-256, preserves producer-reported provenance and edit lineage, and shares it with Canvas. An explicit original message publishes it inline; otherwise it stays in the library. Does not generate, spend, fetch or publish externally.',
 inputSchema:{type:'object',properties:Object.fromEntries([
  ...['sessionId','title','messageId','parentId','evidenceIds'].map(key=>[key,outputSchemas['outputs.attach'].inputSchema.properties[key]]),
  ['receiptPath',{type:'string',minLength:1,maxLength:4000}]
 ]),required:['sessionId','title','receiptPath'],additionalProperties:false}
};
// Native message identity and its host turn remain explicit; neither is inferred.
for(const name of ['outputs.attach','outputs.write','outputs.review','outputs.attachImage'])outputSchemas[name].inputSchema.properties.messageTurnId={type:'string',minLength:1,maxLength:256};

const mediaId={type:'string',minLength:1,maxLength:512}, mediaTuple={sessionId:mediaId,id:mediaId,messageId:mediaId,version:{type:'integer',minimum:1},sha256:{type:'string',pattern:'^[a-f0-9]{64}$'}};
outputSchemas['outputs.attachMedia']={description:'Save exact GIF or MP4 bytes up to 32 MiB at an existing saved assistant message. Supply its messageId and inspected SHA-256. This saves media; it does not prove browser playback or start a turn.',inputSchema:{type:'object',properties:{sessionId:mediaId,messageId:mediaId,messageTurnId:{type:'string',minLength:1,maxLength:256},title:{type:'string',minLength:1,maxLength:200},path:{type:'string',minLength:1,maxLength:4000},expectedSha256:mediaTuple.sha256},required:['sessionId','messageId','title','path','expectedSha256'],additionalProperties:false}};
outputSchemas['outputs.media']={description:'Read up to twenty inline media descriptors for an exact saved assistant message in the attached browser conversation.',inputSchema:{type:'object',properties:{sessionId:mediaId,messageId:mediaId,messageTurnId:{type:'string',minLength:1,maxLength:256}},required:['sessionId','messageId'],additionalProperties:false}};
outputSchemas['outputs.mediaReport']={description:'Authenticated browser playback observation, not model attestation. Never attaches media or starts work.',inputSchema:{type:'object',properties:{...mediaTuple,generation:{type:'integer',minimum:1},sequence:{type:'integer',minimum:1},renderState:{enum:['loading','ready','error']},playback:{enum:['paused','playing','ended']},presentedFrames:{type:'integer',minimum:0},mediaTime:{type:'number',minimum:0},detail:{type:'string',maxLength:500}},required:[...Object.keys(mediaTuple),'generation','sequence','renderState','playback'],additionalProperties:false}};
