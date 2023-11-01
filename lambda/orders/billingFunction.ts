import { SNSEvent, Context } from "aws-lambda"

export async function handler(event: SNSEvent, context: Context): Promise<void> {
    // @note check alternatives to write in batch
    event.Records.forEach((record) => {
        console.log(record.Sns)
    })

    return
}