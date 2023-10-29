import { AWSError, DynamoDB } from "aws-sdk"
import * as AWSXRay from "aws-xray-sdk"
import { Context, SNSEvent, SNSMessage } from "aws-lambda"
import { OrderEventDdb, OrderEventRespository } from "/opt/nodejs/orderEventsRepositoryLayer"
import { Envelope, OrderEvent } from "/opt/nodejs/orderEventsLayer"
import { PromiseResult } from "aws-sdk/lib/request"

AWSXRay.captureAWS(require("aws-sdk"))

const eventsDdb = process.env.EVENTS_DDB!

const ddbClient = new DynamoDB.DocumentClient()
const orderEventsRepository = new OrderEventRespository(ddbClient, eventsDdb)

export async function handler(event: SNSEvent, context: Context): Promise<void> {
    const promises: Promise<PromiseResult<DynamoDB.DocumentClient.PutItemOutput, AWSError>>[] = []

    event.Records.forEach((record) => {
        promises.push(createEvent(record.Sns))
    })

    await Promise.all(promises)

    return 
}

function createEvent(body: SNSMessage) {
    const envelope = JSON.parse(body.Message) as Envelope
    const event = JSON.parse(envelope.data) as OrderEvent

    console.log(`Order event - MessageId: ${body.MessageId}`)

    const timestamp = Date.now()
    // 5 minutes ttl
    const ttl = ~~(timestamp / 1000 + 5 * 60)

    const orderEventsDdb: OrderEventDdb = {
        pk: `#order_${event.orderId}`,
        sk: `${envelope.eventType}#${timestamp}`,
        ttl,
        email: event.email,
        createdAt: timestamp,
        requestId: event.requestId,
        eventType: envelope.eventType,
        info: {
            orderId: event.orderId,
            productCodes: event.productCodes,
            messageId: body.MessageId
        }
    }

    return orderEventsRepository.createOrderEvent(orderEventsDdb)
}