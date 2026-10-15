// Generated from prisma/schema.prisma; only whitelisted models exposed.
export const localFields = {
  "contacts": {
    "id": {
      "type": "String",
      "isRequired": true
    },
    "org_id": {
      "type": "String",
      "isRequired": true
    },
    "name": {
      "type": "String",
      "isRequired": true
    },
    "email": {
      "type": "String",
      "isRequired": false
    },
    "phone": {
      "type": "String",
      "isRequired": false
    },
    "avatar_url": {
      "type": "String",
      "isRequired": false
    },
    "crm_stage": {
      "type": "String",
      "isRequired": true
    },
    "crm_value": {
      "type": "Decimal",
      "isRequired": true
    },
    "custom_fields": {
      "type": "Json",
      "isRequired": true
    },
    "last_seen_at": {
      "type": "DateTime",
      "isRequired": false
    },
    "is_demo": {
      "type": "Boolean",
      "isRequired": true
    },
    "created_at": {
      "type": "DateTime",
      "isRequired": true
    },
    "updated_at": {
      "type": "DateTime",
      "isRequired": true
    }
  },
  "tags": {
    "id": {
      "type": "String",
      "isRequired": true
    },
    "org_id": {
      "type": "String",
      "isRequired": true
    },
    "name": {
      "type": "String",
      "isRequired": true
    },
    "color": {
      "type": "String",
      "isRequired": true
    },
    "created_at": {
      "type": "DateTime",
      "isRequired": true
    }
  },
  "contact_tags": {
    "contact_id": {
      "type": "String",
      "isRequired": true
    },
    "tag_id": {
      "type": "String",
      "isRequired": true
    }
  },
  "conversations": {
    "id": {
      "type": "String",
      "isRequired": true
    },
    "org_id": {
      "type": "String",
      "isRequired": true
    },
    "contact_id": {
      "type": "String",
      "isRequired": true
    },
    "channel": {
      "type": "String",
      "isRequired": true
    },
    "status": {
      "type": "String",
      "isRequired": true
    },
    "assigned_to": {
      "type": "String",
      "isRequired": false
    },
    "subject": {
      "type": "String",
      "isRequired": false
    },
    "unread_count": {
      "type": "Int",
      "isRequired": true
    },
    "last_message_at": {
      "type": "DateTime",
      "isRequired": true
    },
    "is_demo": {
      "type": "Boolean",
      "isRequired": true
    },
    "created_at": {
      "type": "DateTime",
      "isRequired": true
    },
    "updated_at": {
      "type": "DateTime",
      "isRequired": true
    }
  },
  "conversation_tags": {
    "conversation_id": {
      "type": "String",
      "isRequired": true
    },
    "tag_id": {
      "type": "String",
      "isRequired": true
    }
  },
  "messages": {
    "id": {
      "type": "String",
      "isRequired": true
    },
    "conversation_id": {
      "type": "String",
      "isRequired": true
    },
    "org_id": {
      "type": "String",
      "isRequired": true
    },
    "sender_type": {
      "type": "String",
      "isRequired": true
    },
    "sender_id": {
      "type": "String",
      "isRequired": false
    },
    "body": {
      "type": "String",
      "isRequired": true
    },
    "channel": {
      "type": "String",
      "isRequired": true
    },
    "status": {
      "type": "String",
      "isRequired": true
    },
    "is_internal": {
      "type": "Boolean",
      "isRequired": true
    },
    "is_bot": {
      "type": "Boolean",
      "isRequired": true
    },
    "created_at": {
      "type": "DateTime",
      "isRequired": true
    }
  },
  "internal_notes": {
    "id": {
      "type": "String",
      "isRequired": true
    },
    "conversation_id": {
      "type": "String",
      "isRequired": true
    },
    "org_id": {
      "type": "String",
      "isRequired": true
    },
    "author_id": {
      "type": "String",
      "isRequired": true
    },
    "body": {
      "type": "String",
      "isRequired": true
    },
    "created_at": {
      "type": "DateTime",
      "isRequired": true
    }
  },
  "quick_replies": {
    "id": {
      "type": "String",
      "isRequired": true
    },
    "org_id": {
      "type": "String",
      "isRequired": true
    },
    "shortcut": {
      "type": "String",
      "isRequired": true
    },
    "title": {
      "type": "String",
      "isRequired": true
    },
    "body": {
      "type": "String",
      "isRequired": true
    },
    "created_by": {
      "type": "String",
      "isRequired": true
    },
    "created_at": {
      "type": "DateTime",
      "isRequired": true
    }
  },
  "chatbots": {
    "id": {
      "type": "String",
      "isRequired": true
    },
    "org_id": {
      "type": "String",
      "isRequired": true
    },
    "name": {
      "type": "String",
      "isRequired": true
    },
    "description": {
      "type": "String",
      "isRequired": false
    },
    "flow": {
      "type": "Json",
      "isRequired": true
    },
    "status": {
      "type": "String",
      "isRequired": true
    },
    "trigger_channel": {
      "type": "String",
      "isRequired": false
    },
    "trigger_keyword": {
      "type": "String",
      "isRequired": false
    },
    "created_by": {
      "type": "String",
      "isRequired": true
    },
    "created_at": {
      "type": "DateTime",
      "isRequired": true
    },
    "updated_at": {
      "type": "DateTime",
      "isRequired": true
    }
  },
  "automations": {
    "id": {
      "type": "String",
      "isRequired": true
    },
    "org_id": {
      "type": "String",
      "isRequired": true
    },
    "name": {
      "type": "String",
      "isRequired": true
    },
    "description": {
      "type": "String",
      "isRequired": false
    },
    "trigger": {
      "type": "Json",
      "isRequired": true
    },
    "actions": {
      "type": "Json",
      "isRequired": true
    },
    "status": {
      "type": "String",
      "isRequired": true
    },
    "created_by": {
      "type": "String",
      "isRequired": true
    },
    "created_at": {
      "type": "DateTime",
      "isRequired": true
    },
    "updated_at": {
      "type": "DateTime",
      "isRequired": true
    }
  },
  "campaigns": {
    "id": {
      "type": "String",
      "isRequired": true
    },
    "org_id": {
      "type": "String",
      "isRequired": true
    },
    "name": {
      "type": "String",
      "isRequired": true
    },
    "message": {
      "type": "String",
      "isRequired": true
    },
    "channel": {
      "type": "String",
      "isRequired": true
    },
    "segment_tags": {
      "type": "Json",
      "isRequired": true
    },
    "segment_stage": {
      "type": "String",
      "isRequired": false
    },
    "scheduled_at": {
      "type": "DateTime",
      "isRequired": false
    },
    "status": {
      "type": "String",
      "isRequired": true
    },
    "consent_required": {
      "type": "Boolean",
      "isRequired": true
    },
    "daily_limit": {
      "type": "Int",
      "isRequired": true
    },
    "sent_count": {
      "type": "Int",
      "isRequired": true
    },
    "delivered_count": {
      "type": "Int",
      "isRequired": true
    },
    "read_count": {
      "type": "Int",
      "isRequired": true
    },
    "failed_count": {
      "type": "Int",
      "isRequired": true
    },
    "created_by": {
      "type": "String",
      "isRequired": true
    },
    "created_at": {
      "type": "DateTime",
      "isRequired": true
    },
    "updated_at": {
      "type": "DateTime",
      "isRequired": true
    }
  },
  "campaign_recipients": {
    "id": {
      "type": "String",
      "isRequired": true
    },
    "campaign_id": {
      "type": "String",
      "isRequired": true
    },
    "contact_id": {
      "type": "String",
      "isRequired": true
    },
    "status": {
      "type": "String",
      "isRequired": true
    },
    "sent_at": {
      "type": "DateTime",
      "isRequired": false
    },
    "delivered_at": {
      "type": "DateTime",
      "isRequired": false
    },
    "read_at": {
      "type": "DateTime",
      "isRequired": false
    },
    "error": {
      "type": "String",
      "isRequired": false
    },
    "created_at": {
      "type": "DateTime",
      "isRequired": true
    }
  },
  "schedules": {
    "id": {
      "type": "String",
      "isRequired": true
    },
    "org_id": {
      "type": "String",
      "isRequired": true
    },
    "contact_id": {
      "type": "String",
      "isRequired": false
    },
    "title": {
      "type": "String",
      "isRequired": true
    },
    "message": {
      "type": "String",
      "isRequired": false
    },
    "scheduled_at": {
      "type": "DateTime",
      "isRequired": true
    },
    "channel": {
      "type": "String",
      "isRequired": true
    },
    "status": {
      "type": "String",
      "isRequired": true
    },
    "created_by": {
      "type": "String",
      "isRequired": true
    },
    "created_at": {
      "type": "DateTime",
      "isRequired": true
    }
  },
  "teams": {
    "id": {
      "type": "String",
      "isRequired": true
    },
    "org_id": {
      "type": "String",
      "isRequired": true
    },
    "name": {
      "type": "String",
      "isRequired": true
    },
    "description": {
      "type": "String",
      "isRequired": false
    },
    "created_at": {
      "type": "DateTime",
      "isRequired": true
    }
  },
  "org_members": {
    "id": {
      "type": "String",
      "isRequired": true
    },
    "org_id": {
      "type": "String",
      "isRequired": true
    },
    "user_id": {
      "type": "String",
      "isRequired": true
    },
    "role": {
      "type": "String",
      "isRequired": true
    },
    "status": {
      "type": "String",
      "isRequired": true
    },
    "created_at": {
      "type": "DateTime",
      "isRequired": true
    }
  },
  "user_profiles": {
    "id": {
      "type": "String",
      "isRequired": true
    },
    "user_id": {
      "type": "String",
      "isRequired": true
    },
    "full_name": {
      "type": "String",
      "isRequired": true
    },
    "avatar_url": {
      "type": "String",
      "isRequired": false
    },
    "phone": {
      "type": "String",
      "isRequired": false
    },
    "created_at": {
      "type": "DateTime",
      "isRequired": true
    },
    "updated_at": {
      "type": "DateTime",
      "isRequired": true
    }
  },
  "integrations": {
    "id": {
      "type": "String",
      "isRequired": true
    },
    "org_id": {
      "type": "String",
      "isRequired": true
    },
    "type": {
      "type": "String",
      "isRequired": true
    },
    "name": {
      "type": "String",
      "isRequired": true
    },
    "config": {
      "type": "Json",
      "isRequired": true
    },
    "status": {
      "type": "String",
      "isRequired": true
    },
    "last_connected_at": {
      "type": "DateTime",
      "isRequired": false
    },
    "created_at": {
      "type": "DateTime",
      "isRequired": true
    },
    "updated_at": {
      "type": "DateTime",
      "isRequired": true
    }
  }
};
