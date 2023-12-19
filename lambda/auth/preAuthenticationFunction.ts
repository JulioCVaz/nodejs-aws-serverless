import { Callback, Context, PreAuthenticationTriggerEvent } from "aws-lambda";

export async function handler(event: PreAuthenticationTriggerEvent, context: Context, callback: Callback): Promise<void> {
    console.log(event)

    // @note example to block user access 
    // if (event.request.userAttributes.email === "siecola@gmail.com") {
    //     callback("this user is blocked. Reason: PAYMENT", event)
    // }

    callback(null, event)
}