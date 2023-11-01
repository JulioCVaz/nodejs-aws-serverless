import { Context, SQSEvent } from "aws-lambda"
import * as AWSXRay from "aws-xray-sdk"

AWSXRay.captureAWS(require("aws-sdk"))

export async function handler(event: SQSEvent, context: Context): Promise<void>{
    // @note check alternatives to write in batch
    event.Records.forEach((record) => {
        console.log(record)
        const body = JSON.parse(record.body)
        console.log(body)
    })

    return
}